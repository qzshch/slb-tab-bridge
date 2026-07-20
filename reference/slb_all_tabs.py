import sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

ps_script = r'''
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

$procIds = (Get-Process SLBrowser).Id | Sort-Object -Unique
Write-Host "SLBrowser PIDs: $($procIds -join ', ')"
Write-Host ""

$tabCount = 0
$windowIndex = 0

foreach ($procId in $procIds) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)
    $windows = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $cond)

    foreach ($win in $windows) {
        $name = $win.Current.Name
        if (-not $name -or $name.Length -eq 0) { continue }
        $className = $win.Current.ClassName
        if ($className -ne "Chrome_WidgetWin_1") { continue }

        $windowIndex++
        Write-Host "===== Window $windowIndex (PID $procId): $name ====="

        $tabContainerCond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty, "TabContainerImpl")
        $tabContainer = $win.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants, $tabContainerCond)

        if ($tabContainer) {
            $tabItemCond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::TabItem)
            $tabs = $tabContainer.FindAll(
                [System.Windows.Automation.TreeScope]::Children, $tabItemCond)

            $tabCount += $tabs.Count
            $i = 0
            foreach ($tab in $tabs) {
                $i++
                $tabName = $tab.Current.Name
                Write-Host "  [$i] $tabName"
            }
        } else {
            Write-Host "  (no tab container found)"
        }
        Write-Host ""
    }
}

Write-Host "---"
Write-Host "Total windows: $windowIndex, Total tabs: $tabCount"
'''

result = subprocess.run(['powershell', '-Command', ps_script],
                       capture_output=True, text=True, encoding='utf-8')
print(result.stdout)
if result.stderr:
    lines = result.stderr.split('\n')
    unique_errors = []
    seen = set()
    for l in lines:
        l = l.strip()
        if l and l not in seen:
            seen.add(l)
            unique_errors.append(l)
    if unique_errors:
        print("STDERR:", '\n'.join(unique_errors[:5]))
