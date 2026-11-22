' Runs the launcher with no console window (style 0). Output goes to %USERPROFILE%\.openkrishbot\launcher.log
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Environment("PROCESS")("OPENKRISHBOT_HIDDEN") = "1"
sh.CurrentDirectory = root
sh.Run "node """ & root & "\scripts\launch.mjs""", 0, False
