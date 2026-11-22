' Kitchen Hub: starts the hub and the tray icon without any black windows.
Set sh = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & d & "\run-hub.cmd""", 0, False
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & d & "\tray.ps1""", 0, False
