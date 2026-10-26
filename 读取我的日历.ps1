# 读取这台电脑的 Windows 日历，导出成记账本能导入的 .ics 文件
# 用法：双击同目录下的「读取我的日历.bat」

$ErrorActionPreference = 'Stop'
$outFile = Join-Path $PSScriptRoot '我的日历.ics'

Write-Host ''
Write-Host '  记账本 · 读取 Windows 日历' -ForegroundColor Cyan
Write-Host '  --------------------------------' -ForegroundColor DarkGray
Write-Host ''

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    function Await($op, $type) {
        $t = $asTaskGeneric.MakeGenericMethod($type)
        $task = $t.Invoke($null, @($op))
        $task.Wait(-1) | Out-Null
        $task.Result
    }

    [void][Windows.ApplicationModel.Appointments.AppointmentManager, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime]
    [void][Windows.ApplicationModel.Appointments.AppointmentStoreAccessType, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime]

    $store = Await ([Windows.ApplicationModel.Appointments.AppointmentManager]::RequestStoreAsync(
            [Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadOnly
        )) ([Windows.ApplicationModel.Appointments.AppointmentStore])

    $appts = Await ($store.FindAppointmentsAsync(
            [DateTimeOffset]::Now.AddYears(-1),
            [TimeSpan]::FromDays(730)
        )) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
}
catch {
    Write-Host ('  读取失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ''
    Read-Host '  按回车退出'
    exit 1
}

if ($appts.Count -eq 0) {
    Write-Host '  这台电脑的 Windows 日历里还没有日程。' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  可以换个办法：' -ForegroundColor Gray
    Write-Host '    · 手机日历 → 设置 → 导出日历 → 下载 .ics' -ForegroundColor Gray
    Write-Host '    · Google 日历 → 设置 → 导入和导出 → 导出' -ForegroundColor Gray
    Write-Host '    · Outlook → 文件 → 另存为 → iCalendar 格式' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  拿到 .ics 文件后，在记账本「设置 → 日历日程 → 导入 .ics 日历文件」就行。' -ForegroundColor Gray
    Write-Host ''
    Read-Host '  按回车退出'
    exit 0
}

function Esc([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '' }
    return $s.Replace('\', '\\').Replace(';', '\;').Replace(',', '\,').Replace("`r`n", '\n').Replace("`n", '\n')
}

function Fold([string]$line) {
    if ($line.Length -le 25) { return $line }
    $out = New-Object System.Collections.ArrayList
    [void]$out.Add($line.Substring(0, 25))
    $pos = 25
    while ($pos -lt $line.Length) {
        $len = [Math]::Min(24, $line.Length - $pos)
        [void]$out.Add(' ' + $line.Substring($pos, $len))
        $pos += $len
    }
    return ($out -join "`r`n")
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('BEGIN:VCALENDAR')
[void]$sb.AppendLine('VERSION:2.0')
[void]$sb.AppendLine('PRODID:-//MoneyBook//Windows Calendar//CN')
[void]$sb.AppendLine('CALSCALE:GREGORIAN')

$i = 0
foreach ($a in $appts) {
    $i++
    $start = $a.StartTime.LocalDateTime
    [void]$sb.AppendLine('BEGIN:VEVENT')
    [void]$sb.AppendLine('UID:win_' + $i + '_' + $start.ToString('yyyyMMddHHmmss'))
    [void]$sb.AppendLine((Fold ('SUMMARY:' + (Esc $a.Subject))))
    if ($a.AllDay) {
        [void]$sb.AppendLine('DTSTART;VALUE=DATE:' + $start.ToString('yyyyMMdd'))
    }
    else {
        [void]$sb.AppendLine('DTSTART:' + $start.ToString('yyyyMMddTHHmmss'))
    }
    if (-not [string]::IsNullOrWhiteSpace($a.Location)) {
        [void]$sb.AppendLine((Fold ('LOCATION:' + (Esc $a.Location))))
    }
    [void]$sb.AppendLine('END:VEVENT')
}
[void]$sb.AppendLine('END:VCALENDAR')

[System.IO.File]::WriteAllText($outFile, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Host ('  已导出 ' + $appts.Count + ' 条日程') -ForegroundColor Green
Write-Host ('  文件：' + $outFile) -ForegroundColor Gray
Write-Host ''
Write-Host '  下一步：打开记账本 → 设置 → 日历日程 → 导入 .ics 日历文件' -ForegroundColor Cyan
Write-Host '          选中刚生成的「我的日历.ics」就行了。' -ForegroundColor Cyan
Write-Host ''

$open = Read-Host '  现在打开记账本吗？(y/N)'
if ($open -match '^[yY]') {
    $target = Join-Path $PSScriptRoot '启动记账本.bat'
    if (Test-Path $target) { Start-Process -FilePath $target }
}

Write-Host ''
