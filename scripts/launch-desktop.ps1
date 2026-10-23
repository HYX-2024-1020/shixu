param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$appUrl = 'http://localhost:5173/'
function Test-App {
    try {
        $request = [System.Net.WebRequest]::Create('http://127.0.0.1:5173/')
        $request.Proxy = $null
        $request.Timeout = 2000
        $response = $request.GetResponse()
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        try { $content = $reader.ReadToEnd() } finally { $reader.Dispose(); $response.Dispose() }
        if ($content -match '/src/main.tsx') { return $true }
        throw 'Port 5173 is occupied by another application.'
    } catch [System.Net.WebException] { return $false }
}
try {
    if (-not (Test-App)) {
        $nodePath = (Get-Command node -ErrorAction Stop).Source
        $vitePath = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'
        if (-not (Test-Path -LiteralPath $vitePath)) {
            throw 'Dependencies are missing. Run npm ci in the Shixu project folder.'
        }
        $logDir = Join-Path $projectRoot '.private'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'desktop-out.log') -RedirectStandardError (Join-Path $logDir 'desktop-error.log') -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-App) { $ready = $true; break }
            if ($process.HasExited) { break }
        }
        if (-not $ready) { throw 'Shixu could not start. Check .private/desktop-error.log in the project folder.' }
    }
    if (-not $NoBrowser) { Start-Process $appUrl }
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Shixu startup failed') | Out-Null
    exit 1
}
