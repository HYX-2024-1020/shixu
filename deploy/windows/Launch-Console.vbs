Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File """ & files.BuildPath(root, "Launch-Cloud.ps1") & """"
If WScript.Arguments.Named.Exists("headless") Then command = command & " -Headless"
shell.Run command, 0, False
