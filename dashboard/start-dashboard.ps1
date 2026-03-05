# Kill anything on port 3333 before starting
$proc = netstat -ano | Select-String ":3333 " | Where-Object { $_ -match "LISTENING" } | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -First 1
if ($proc) {
    Write-Host "Killing existing process on port 3333 (PID $proc)"
    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
    Start-Sleep 1
}
# Start the dashboard
node "C:\Users\gavin\clawd\aaa-bot\dashboard\server.js"
