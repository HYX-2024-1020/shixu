param([Alias("Headless")][switch]$NoBrowser)
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Shixu\Connection'
$config=Get-Content -LiteralPath (Join-Path $root 'connection.json') -Raw | ConvertFrom-Json
if($config.version -ne 1 -or $config.host -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or $config.user -ne 'shixu-access'){throw 'Invalid private connection'}
$ssh=Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$record=Join-Path $PSScriptRoot 'cloud-running.json'
$reuse=$false
if(Test-Path -LiteralPath $record){
  $old=Get-Content -LiteralPath $record -Raw|ConvertFrom-Json
  $process=Get-Process -Id $old.pid -ErrorAction SilentlyContinue
  if($process -and $process.Path -eq $ssh -and $process.StartTime.ToUniversalTime().Ticks -eq $old.ticks){$reuse=$true}
}
if(-not $reuse){
  if(Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue){throw 'Console port is occupied by another process'}
  $args=@('-N','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile="'+(Join-Path $root 'known_hosts')+'"'),'-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-i',('"'+(Join-Path $root 'id_ed25519')+'"'),'-L','127.0.0.1:18789:127.0.0.1:8791',($config.user+'@'+$config.host))
  $process=Start-Process -FilePath $ssh -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $PSScriptRoot 'logs\cloud-ssh.log')
  Start-Sleep -Milliseconds 300
  @{pid=$process.Id;ticks=$process.StartTime.ToUniversalTime().Ticks}|ConvertTo-Json|Set-Content -LiteralPath $record -Encoding UTF8
}
$ready=$false
for($attempt=0;$attempt -lt 30;$attempt++){
  $process.Refresh()
  if($process.HasExited){throw 'Protected cloud connection failed. Check connection credentials and service status.'}
  $listener=Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue
  if($listener -and $listener.OwningProcess -eq $process.Id){
    try{$response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18789/admin/v1/session' -TimeoutSec 2;if($response.StatusCode -eq 200){$ready=$true;break}}catch{}
  }
  Start-Sleep -Milliseconds 300
}
if(-not $ready){throw 'Cloud console is unavailable; reopen this shortcut after checking the network.'}
if(-not $NoBrowser){Start-Process 'http://127.0.0.1:18789/admin/?api=http'}
