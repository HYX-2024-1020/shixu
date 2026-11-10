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
  $sshArguments=@('-N','-T','-F',('"'+(Join-Path $root 'ssh_config')+'"'),'-o','ExitOnForwardFailure=yes','-L','127.0.0.1:18789:127.0.0.1:8791','shixu-private')
  $process=Start-Process -FilePath $ssh -ArgumentList $sshArguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $PSScriptRoot 'logs\cloud-ssh.log')
  Start-Sleep -Milliseconds 300
  $process.Refresh()
  if($process.HasExited){throw 'Protected SSH connection failed. See logs/cloud-ssh.log.'}
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
$current=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.json') -Raw|ConvertFrom-Json
if($current.release -notmatch '^cloud-[a-f0-9]{40}$'){throw 'Installed console bundle is missing'}
$releaseRoot=Join-Path $PSScriptRoot ('releases\'+$current.release)
$manifest=Get-Content -LiteralPath (Join-Path $releaseRoot 'installation-manifest.json') -Raw|ConvertFrom-Json
foreach($file in $manifest.files){
  $target=[IO.Path]::GetFullPath((Join-Path $releaseRoot $file.path))
  if(-not $target.StartsWith(($releaseRoot+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid console manifest path'}
  if(-not(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256){throw 'Console installation failed integrity verification'}
}
$node=Join-Path $releaseRoot 'node.exe'
$gatewayRecord=Join-Path $PSScriptRoot 'gateway-running.json'
$gateway=$null
if(Test-Path -LiteralPath $gatewayRecord){
  $oldGateway=Get-Content -LiteralPath $gatewayRecord -Raw|ConvertFrom-Json
  $candidate=Get-Process -Id $oldGateway.pid -ErrorAction SilentlyContinue
  $owned=$candidate -and $candidate.Path -eq $oldGateway.nodePath -and $candidate.StartTime.ToUniversalTime().Ticks -eq $oldGateway.ticks -and $oldGateway.nodePath.StartsWith(($PSScriptRoot+'\releases\'),[StringComparison]::OrdinalIgnoreCase)
  if($owned){if($candidate.Path -eq $node){$gateway=$candidate}else{Stop-Process -Id $candidate.Id;Start-Sleep -Milliseconds 300}}
}
if(-not $gateway){
  if(Get-NetTCPConnection -LocalPort 8789 -State Listen -ErrorAction SilentlyContinue){throw 'Local console port belongs to another process'}
  $entry=Join-Path $releaseRoot 'server\console-gateway.mjs'
  $gateway=Start-Process -FilePath $node -ArgumentList ('"'+$entry+'"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\gateway.log') -RedirectStandardError (Join-Path $PSScriptRoot 'logs\gateway-error.log')
  Start-Sleep -Milliseconds 300;$gateway.Refresh()
  if($gateway.HasExited){throw 'Local console gateway could not start'}
  @{pid=$gateway.Id;ticks=$gateway.StartTime.ToUniversalTime().Ticks;nodePath=$node;release=$current.release}|ConvertTo-Json|Set-Content -LiteralPath $gatewayRecord -Encoding UTF8
}
$gatewayReady=$false
for($attempt=0;$attempt -lt 15;$attempt++){
  $gateway.Refresh();if($gateway.HasExited){throw 'Local console gateway stopped'}
  $listener=Get-NetTCPConnection -LocalPort 8789 -State Listen -ErrorAction SilentlyContinue
  if($listener -and $listener.OwningProcess -eq $gateway.Id){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8789/__shixu_console_health' -TimeoutSec 2;if($health.application -eq 'shixu-console-gateway' -and $health.release -eq $current.fingerprint){$gatewayReady=$true;break}}catch{}
  }
  Start-Sleep -Milliseconds 200
}
if(-not $gatewayReady){throw 'Local console gateway verification failed'}
if(-not $NoBrowser){Start-Process 'http://127.0.0.1:8789/admin/?api=http'}
