@echo off
rem Knowbase one-click launcher (desktop copy: 启动Knowbase.bat)
cd /d "E:\Projects\KnowledgeRecorder"
node "scripts\start-desktop.js"
if errorlevel 1 pause
