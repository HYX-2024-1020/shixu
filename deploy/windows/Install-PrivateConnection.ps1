param([Parameter(Mandatory=$true)][string]$CloudHost,[Parameter(Mandatory=$true)][string]$SourceRevision)
$ErrorActionPreference='Stop'
if($CloudHost -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or $SourceRevision -notmatch '^[a-f0-9]{40}$'){throw 'Invalid connection provisioning arguments'}
$root=Join-Path $env:LOCALAPPDATA 'Shixu\Connection'
$console=Join-Path $env:LOCALAPPDATA 'Shixu\AdminConsole'
New-Item -ItemType Directory -Force $root,(Join-Path $console 'logs')|Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $root /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
if($LASTEXITCODE -ne 0){throw 'Connection directory ACL failed'}
$trusted=@(& ssh-keygen.exe -F $CloudHost -f (Join-Path $env:USERPROFILE '.ssh\known_hosts'))
if($LASTEXITCODE -ne 0 -or $trusted.Count -lt 2){throw 'Verify the existing SSH host key before provisioning'}
[IO.File]::WriteAllLines((Join-Path $root 'known_hosts'),$trusted,(New-Object Text.UTF8Encoding($false)))
$key=Join-Path $root 'id_ed25519'
if(-not(Test-Path -LiteralPath $key)){
  # Windows PowerShell 5 needs explicit empty argument quoting for ssh-keygen.
  $process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe') -ArgumentList @('-q','-t','ed25519','-N','""','-C','shixu-private-forward-only','-f',('"'+$key+'"')) -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw 'Dedicated SSH key generation failed'}
}
[IO.File]::WriteAllText((Join-Path $root 'connection.json'),(@{version=1;host=$CloudHost;user='shixu-access'}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$sshConfig=@('Host shixu-private',('    HostName '+$CloudHost),'    User shixu-access',('    UserKnownHostsFile "'+(Join-Path $root 'known_hosts').Replace('\','/')+'"'),('    IdentityFile "'+$key.Replace('\','/')+'"'),'    IdentitiesOnly yes','    StrictHostKeyChecking yes','    BatchMode yes','    ConnectTimeout 10','    ServerAliveInterval 15','    ServerAliveCountMax 2')
[IO.File]::WriteAllLines((Join-Path $root 'ssh_config'),$sshConfig,(New-Object Text.UTF8Encoding($false)))
$old=Join-Path $console 'Launch.ps1'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$builder=Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'scripts\build-console-release.mjs'
$bundleOutput=& $node $builder $console $SourceRevision
if($LASTEXITCODE -ne 0){throw 'Console bundle build failed; existing installation preserved'}
$bundle=$bundleOutput | ConvertFrom-Json
if((Test-Path -LiteralPath $old) -and -not(Test-Path -LiteralPath (Join-Path $console 'Launch.local-login.ps1'))){Copy-Item -LiteralPath $old -Destination (Join-Path $console 'Launch.local-login.ps1')}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Launch-Console.ps1') -Destination $old
[IO.File]::WriteAllText((Join-Path $console 'current.json.next'),(@{application='shixu-admin-console';role='local-assets-cloud-api';release=$bundle.release;fingerprint=$bundle.fingerprint;sourceCommit=$bundle.sourceRevision;origin='http://127.0.0.1:8789';upstream='http://127.0.0.1:18789';launcherSha256=(Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath (Join-Path $console 'current.json.next') -Destination (Join-Path $console 'current.json') -Force
Write-Output 'private-connection-installed; authorize only the generated .pub key for restricted forwarding'
