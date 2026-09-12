@echo off
title Phrontis Dev - AI/Plugin worktree (feature/ai-plugin-upgrade)
cd /d E:\Projects\KnowledgeRecorder-ai-plugin

echo ==================================================
echo  Phrontis Dev (worktree: AI module + plugins)
echo  Branch : feature/ai-plugin-upgrade
echo  Folder : E:\Projects\KnowledgeRecorder-ai-plugin
echo ==================================================
echo.
echo [Note] The app uses a single-instance lock. If another
echo        instance (main worktree) is running, this one
echo        will just hand focus over. Close it first.
echo.

if not exist node_modules (
  echo [Setup] First run - installing dependencies...
  call npm install --no-audit --no-fund
)

call npm run dev
pause
