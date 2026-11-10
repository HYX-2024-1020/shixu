Option Explicit
Dim shell, files, root, command, status, log, edge, browser, origin
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
Set log = files.CreateTextFile(files.BuildPath(root, "logs\last-shell-launch.txt"), True, True)
log.WriteLine WScript.ScriptFullName
log.WriteLine "starting " & Now
log.Close
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File """ & files.BuildPath(root, "Launch-Cloud.ps1") & """"
status = shell.Run(command & " -Headless", 0, True)
If status <> 0 Then
  MsgBox "Shixu console could not start. See logs\last-launch.json in " & root, 16, "Shixu console"
  WScript.Quit status
End If
If WScript.Arguments.Named.Exists("headless") Then WScript.Quit 0
origin = "http://127.0.0.1:8789/admin/?api=http"
edge = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
If Not files.FileExists(edge) Then edge = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
If files.FileExists(edge) Then
  browser = """" & edge & """ --no-first-run --no-default-browser-check --new-window --user-data-dir=""" & files.BuildPath(root, "browser-profile") & """ --app=""" & origin & """"
  shell.Run browser, 1, False
Else
  shell.Run origin, 1, False
End If
