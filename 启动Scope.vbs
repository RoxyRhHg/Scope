Set shell = CreateObject("WScript.Shell")
scriptPath = """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\scripts\launch_scope.ps1"""
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & scriptPath, 0, False
