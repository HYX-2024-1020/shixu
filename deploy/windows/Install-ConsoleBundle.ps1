param([switch]$VerifyOnly)
$ErrorActionPreference='Stop'
function Hash-File([string]$Path){
  $stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create()
  try{return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','')}
  finally{$algorithm.Dispose();$stream.Dispose()}
}
try {
  $delivery=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'delivery.json') -Raw|ConvertFrom-Json
  if($delivery.release -notmatch '^cloud-[a-f0-9]{40}$' -or $delivery.fingerprint -notmatch '^[a-f0-9]{64}$' -or $delivery.sourceRevision -notmatch '^[a-f0-9]{40}$'){throw 'Invalid delivery identity'}
  if((Hash-File $PSCommandPath) -ne $delivery.installerSha256){throw 'Installer checksum failed'}
  $payload=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'payload'))+'\'
  $console=Join-Path $env:LOCALAPPDATA 'Shixu\AdminConsole'
  $connection=Join-Path $env:LOCALAPPDATA 'Shixu\Connection'
  $prepared=@()
  foreach($file in $delivery.files){
    if($file.group -notin @('console','connection') -or $file.path -notmatch '^[\w./-]+$' -or $file.path.Contains('..')){throw 'Invalid payload path'}
    if($file.group -eq 'connection' -and $file.path -notin @('connection.json','known_hosts','id_ed25519','ssh_config')){throw 'Unexpected connection file'}
    if($file.group -eq 'console' -and $file.path -notin @('Launch-Cloud.ps1','Launch.ps1','Cloud-Start.vbs','Launch.vbs','console-xu-v1.ico','current.json') -and -not $file.path.StartsWith(('releases/'+$delivery.release+'/'))){throw 'Unexpected console file'}
    $source=[IO.Path]::GetFullPath((Join-Path $payload ($file.group+'\'+$file.path)))
    if(-not $source.StartsWith($payload,[StringComparison]::OrdinalIgnoreCase) -or (Hash-File $source) -ne $file.sha256){throw 'Payload checksum failed'}
    $targetRoot=if($file.group -eq 'console'){$console}else{$connection}
    $target=[IO.Path]::GetFullPath((Join-Path $targetRoot $file.path))
    if(-not $target.StartsWith(($targetRoot+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid installation path'}
    $prepared+=@{source=$source;target=$target;hash=$file.sha256;name=$file.path;group=$file.group}
  }
  if($VerifyOnly){Write-Output 'Offline bundle checksums verified';exit 0}
  New-Item -ItemType Directory -Force $console,$connection,(Join-Path $console 'logs')|Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $connection /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
  if($LASTEXITCODE -ne 0){throw 'Private connection permissions failed'}
  if($delivery.pairingRequired){
    $code=Read-Host '请粘贴代理提供的连接配对码'
    $pair=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($code.Trim()))|ConvertFrom-Json
    if($pair.host -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or $pair.knownHosts.Length -gt 16384 -or $pair.knownHosts -notmatch '(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) '){throw 'Invalid pairing code'}
    $key=Join-Path $connection 'id_ed25519'
    $sshKeygen=Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
    if(-not(Test-Path -LiteralPath $key)){
      $generate=Start-Process -FilePath $sshKeygen -ArgumentList @('-q','-t','ed25519','-N','""','-C','shixu-user-console','-f',('"'+$key+'"')) -WindowStyle Hidden -Wait -PassThru
      if($generate.ExitCode -ne 0){throw 'SSH key generation failed'}
    }
    if(-not(Test-Path -LiteralPath ($key+'.pub'))){throw 'Public key file missing; existing private key preserved'}
    [IO.File]::WriteAllText((Join-Path $connection 'known_hosts'),$pair.knownHosts,(New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $connection 'connection.json'),(@{version=1;host=$pair.host;user='shixu-access'}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
    $sshConfig=@('Host shixu-private',('    HostName '+$pair.host),'    User shixu-access',('    UserKnownHostsFile "'+(Join-Path $connection 'known_hosts').Replace('\','/')+'"'),('    IdentityFile "'+$key.Replace('\','/')+'"'),'    IdentitiesOnly yes','    StrictHostKeyChecking yes','    BatchMode yes','    ConnectTimeout 10','    ServerAliveInterval 15','    ServerAliveCountMax 2')
    [IO.File]::WriteAllLines((Join-Path $connection 'ssh_config'),$sshConfig,(New-Object Text.UTF8Encoding($false)))
    $publicKey=Get-Content -LiteralPath ($key+'.pub') -Raw
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'public-key.txt'),$publicKey)
    Write-Output '请将下面这一整行公钥发给代理，私钥不要发送：'
    Write-Output $publicKey
    Read-Host '代理确认已授权后，按回车继续安装'|Out-Null
    $delivery.runtime=$pair.runtime
  }
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
  foreach($file in $prepared){
    New-Item -ItemType Directory -Force (Split-Path $file.target -Parent)|Out-Null
    if($delivery.pairingRequired -and $file.name -eq 'console-xu-v1.ico' -and (Test-Path -LiteralPath $file.target)){continue}
    if(Test-Path -LiteralPath $file.target){
      if((Hash-File $file.target) -eq $file.hash){continue}
      if($file.name.StartsWith('releases/')){throw 'Immutable installed release differs'}
      $backupRoot=if($file.group -eq 'connection'){$connection}else{$console}
      $backup=Join-Path $backupRoot ('backups\'+$stamp+'\'+$file.name)
      New-Item -ItemType Directory -Force (Split-Path $backup -Parent)|Out-Null
      Copy-Item -LiteralPath $file.target -Destination $backup
    }
    Copy-Item -LiteralPath $file.source -Destination ($file.target+'.next')
    Move-Item -LiteralPath ($file.target+'.next') -Destination $file.target -Force
    if((Hash-File $file.target) -ne $file.hash){throw 'Installed file checksum failed'}
  }
  foreach($property in $delivery.runtime.PSObject.Properties){
    $record=$property.Value
    $expected=if($property.Name -eq 'cloud-running.json'){Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'}elseif($property.Name -eq 'gateway-running.json'){Join-Path $console ('releases\'+$delivery.release+'\node.exe')}else{continue}
    $process=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if($delivery.pairingRequired -and $property.Name -eq 'gateway-running.json' -and $process -and $process.StartTime.ToUniversalTime().Ticks -eq $record.ticks -and $process.Path -eq $record.nodePath -and $process.Path.StartsWith(($console+'\releases\'),[StringComparison]::OrdinalIgnoreCase) -and $process.Path -match '\\cloud-[a-f0-9]{40}\\node\.exe$' -and $process.Path -ne $expected){Stop-Process -Id $process.Id;Start-Sleep -Milliseconds 300;$process=$null}
    if($process -and $process.Path -eq $expected -and $process.StartTime.ToUniversalTime().Ticks -eq $record.ticks){
      $record|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $console $property.Name) -Encoding UTF8
    }
  }
  $wsh=New-Object -ComObject WScript.Shell
  $shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) '拾序管理控制台.lnk'
  if((Test-Path -LiteralPath $shortcutPath) -and -not(Test-Path -LiteralPath (Join-Path $console 'shortcut.before-user-install.lnk'))){Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $console 'shortcut.before-user-install.lnk')}
  $shortcut=$wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\wscript.exe'
  $shortcut.Arguments='"'+(Join-Path $console 'Cloud-Start.vbs')+'"'
  $shortcut.WorkingDirectory=$console;$shortcut.WindowStyle=7
  $shortcut.IconLocation=(Join-Path $console 'console-xu-v1.ico')+',0'
  $shortcut.Save()
  & (Join-Path $env:SystemRoot 'System32\cscript.exe') //Nologo (Join-Path $console 'Cloud-Start.vbs') /headless
  if($LASTEXITCODE -ne 0){throw 'Installed console startup failed'}
  $launch=Get-Content -LiteralPath (Join-Path $console 'logs\last-launch.json') -Raw|ConvertFrom-Json
  if($launch.phase -ne 'ready' -or $launch.fingerprint -ne $delivery.fingerprint){throw 'Installed console is not ready'}
  $receipt=@{success=$true;at=[DateTime]::UtcNow.ToString('o');source=$delivery.sourceRevision;installRoot=$console;launcherExists=(Test-Path -LiteralPath (Join-Path $console 'Cloud-Start.vbs'));verifiedFiles=$prepared.Count;gatewayPID=$launch.gatewayPID}
  $receipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'install-result.json') -Encoding UTF8
  Write-Output '安装完成。请关闭旧报错框，然后双击桌面拾序管理控制台。'
} catch {
  @{success=$false;at=[DateTime]::UtcNow.ToString('o');code=$_.FullyQualifiedErrorId;line=$_.InvocationInfo.ScriptLineNumber}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'install-result.json') -Encoding UTF8
  Write-Error $_
  exit 1
}
