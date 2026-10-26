@echo off
title 读取我的日历
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0读取我的日历.ps1"
pause