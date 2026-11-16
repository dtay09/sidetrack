@echo off
title Sidetrack
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Open
