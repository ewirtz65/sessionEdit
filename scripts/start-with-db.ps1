#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# cd to repo root (this file lives in .\scripts\)
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location ..

# Start your Node server (MySQL should already be running as a Windows service)
node server\src\server.js
