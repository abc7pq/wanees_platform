param(
  [string]$Base = "http://127.0.0.1:3100",
  [string]$Slug = "boulevard-world-demo"
)

$ErrorActionPreference = "Stop"
$tmpRoot = [System.IO.Path]::GetTempPath()
$tmp = Join-Path $tmpRoot ("wanees-contract-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$results = New-Object System.Collections.Generic.List[object]
$script:bodyFile = Join-Path $tmp "body.json"
$script:outFile = Join-Path $tmp "out.json"
$script:headerFile = Join-Path $tmp "headers.txt"
# Windows PowerShell aliases `curl` to Invoke-WebRequest; prefer the real curl binary when present.
$script:curlExe = if (Get-Command curl.exe -ErrorAction SilentlyContinue) { "curl.exe" } else { "curl" }

function Invoke-Call {
  param([string]$Method, [string]$Path, [string]$Token, $BodyObject, [hashtable]$Headers)
  $curlArgs = @("-s", "-m", "45", "-o", $script:outFile, "-D", $script:headerFile, "-w", "%{http_code}", "-X", $Method)
  if ($Token) { $curlArgs += @("-H", "x-wanees-session-token: $Token") }
  if ($Headers) {
    foreach ($name in $Headers.Keys) {
      $curlArgs += @("-H", "${name}: $($Headers[$name])")
    }
  }
  if ($null -ne $BodyObject) {
    [System.IO.File]::WriteAllText($script:bodyFile, ($BodyObject | ConvertTo-Json -Depth 10 -Compress), (New-Object System.Text.UTF8Encoding($false)))
    $curlArgs += @("-H", "content-type: application/json", "--data-binary", "@$script:bodyFile")
  }
  $status = (& $script:curlExe @curlArgs "$Base$Path").Trim()
  $raw = ""
  if (Test-Path $script:outFile) { $raw = [System.IO.File]::ReadAllText($script:outFile) }
  $rawHeaders = ""
  if (Test-Path $script:headerFile) {
    $rawHeaders = [System.IO.File]::ReadAllText($script:headerFile)
    Remove-Item $script:headerFile -Force -ErrorAction SilentlyContinue
  }
  $json = $null
  if ($raw) { try { $json = $raw | ConvertFrom-Json } catch { } }
  return [pscustomobject]@{ Status = [int]$status; Json = $json; Raw = $raw; HeadersRaw = $rawHeaders }
}

function Get-HeaderValue([string]$RawHeaders, [string]$Name) {
  foreach ($line in ($RawHeaders -split "`r?`n")) {
    $idx = $line.IndexOf(":")
    if ($idx -gt 0 -and $line.Substring(0, $idx).Trim() -ieq $Name) {
      return $line.Substring($idx + 1).Trim()
    }
  }
  return $null
}

function Check([string]$Name, [bool]$Ok, [string]$Detail = "") {
  $results.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail })
}

function Check-Correlation($Call, [string]$Label) {
  $header = Get-HeaderValue $Call.HeadersRaw "x-request-id"
  $meta = if ($Call.Json) { $Call.Json.meta.requestId } else { $null }
  Check "$Label keeps response request-id correlated" ([bool]$header -and $meta -eq $header) "$meta vs $header"
}

function Check-Fields($Object, [string[]]$Fields, [string]$Label) {
  $missing = @()
  foreach ($f in $Fields) {
    if ($null -eq $Object) { $missing += "(null object)"; break }
    if (-not ($Object.PSObject.Properties.Name -contains $f)) { $missing += $f }
  }
  Check "$Label exposes required fields" ($missing.Count -eq 0) ("missing: " + ($missing -join ", "))
}

# 1. session create
$s = Invoke-Call "POST" "/api/v1/events/$Slug/session" $null @{ clientType = "native"; locale = "ar-SA" } @{ "x-request-id" = "contract-session-1" }
Check "POST /session returns 201" ($s.Status -eq 201) "$($s.Status) $($s.Raw.Substring(0,[Math]::Min(200,$s.Raw.Length)))"
Check-Correlation $s "POST /session"
Check-Fields $s.Json.meta @("contractVersion", "requestId") "session meta"
Check "meta.contractVersion is v1" ($s.Json.meta.contractVersion -eq "v1") "$($s.Json.meta.contractVersion)"
Check-Fields $s.Json.data @("sessionId", "authMode", "eventSlug", "catalogVersionId", "expiresAt", "preferences", "clock") "CreateSessionResponse"
Check-Fields $s.Json.data.clock @("nowMinute", "actualMinute", "timezone", "isWithinEvent", "isOpen", "source") "Clock"
$token = $s.Json.data.token

# 2. auth failure contract
$noAuth = Invoke-Call "GET" "/api/v1/events/$Slug/itinerary" $null $null
Check "GET /itinerary without token returns 401" ($noAuth.Status -eq 401) "$($noAuth.Status)"
Check-Correlation $noAuth "GET /itinerary 401"
Check "401 uses error.code SESSION_TOKEN_REQUIRED" ($noAuth.Json.error.code -eq "SESSION_TOKEN_REQUIRED") "$($noAuth.Json.error.code)"

# 3. invalid body
$bad = Invoke-Call "POST" "/api/v1/events/$Slug/session" $null @{ clientType = "television" }
Check "invalid clientType returns 400 INVALID_REQUEST" ($bad.Status -eq 400 -and $bad.Json.error.code -eq "INVALID_REQUEST") "$($bad.Status) $($bad.Json.error.code)"

# 4. itinerary create
$plan = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary" $token @{ preferences = @{ mood = "family"; budgetMaxCents = 20000; availableMinutes = 120; interests = @("games", "food"); companions = "family" } }
Check "POST /itinerary returns 201" ($plan.Status -eq 201) "$($plan.Status) $($plan.Raw.Substring(0,[Math]::Min(200,$plan.Raw.Length)))"
Check-Fields $plan.Json.data @("itineraryId", "sessionId", "profile", "itinerary", "itineraryItems", "nowText", "clock") "ItineraryResponse"
Check-Fields $plan.Json.data.itinerary @("stops", "unfulfilled", "explanations", "score", "total_cost") "Itinerary"
if ($plan.Json.data.itinerary.stops.Count -gt 0) {
  Check-Fields $plan.Json.data.itinerary.stops[0] @("act_id", "zone", "start", "end", "walk_min", "wait_min", "price", "name", "note") "Stop"
}

# 5. itinerary read
$read = Invoke-Call "GET" "/api/v1/events/$Slug/itinerary" $token $null
Check "GET /itinerary returns 200" ($read.Status -eq 200) "$($read.Status)"
Check "GET /itinerary returns the same id" ($read.Json.data.itineraryId -eq $plan.Json.data.itineraryId) "$($read.Json.data.itineraryId) vs $($plan.Json.data.itineraryId)"

# 5b. idempotent itinerary create: same key + same body must replay, not create a second plan
$idemKey = [guid]::NewGuid().ToString()
$idemBody = @{ preferences = @{ mood = "family"; availableMinutes = 90; interests = @("food") } }
$idemFirst = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary" $token $idemBody @{ "idempotency-key" = $idemKey }
$idemSecond = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary" $token $idemBody @{ "idempotency-key" = $idemKey }
Check "idempotent POST /itinerary returns 201 twice" ($idemFirst.Status -eq 201 -and $idemSecond.Status -eq 201) "$($idemFirst.Status)/$($idemSecond.Status)"
Check "idempotent retry replays the same itinerary id" ($idemFirst.Json.data.itineraryId -eq $idemSecond.Json.data.itineraryId) "$($idemFirst.Json.data.itineraryId) vs $($idemSecond.Json.data.itineraryId)"
Check "idempotent retry sets Idempotent-Replay: true" ((Get-HeaderValue $idemSecond.HeadersRaw "idempotent-replay") -eq "true") (Get-HeaderValue $idemSecond.HeadersRaw "idempotent-replay")
$idemReuse = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary" $token @{ preferences = @{ mood = "solo" } } @{ "idempotency-key" = $idemKey }
Check "same key with a different body returns 409 IDEMPOTENCY_KEY_REUSED" ($idemReuse.Status -eq 409 -and $idemReuse.Json.error.code -eq "IDEMPOTENCY_KEY_REUSED") "$($idemReuse.Status) $($idemReuse.Json.error.code)"

# 6. live
$live = Invoke-Call "GET" "/api/v1/events/$Slug/live" $null $null
Check "GET /live returns 200" ($live.Status -eq 200) "$($live.Status)"
Check-Fields $live.Json.data @("event", "catalogVersionId", "capturedAt", "clock", "revision", "nextPollAfterMs", "staleAfterMs", "crowd", "updates") "LiveState"

# 7. map
$map = Invoke-Call "GET" "/api/v1/events/$Slug/map" $null $null
Check "GET /map returns 200" ($map.Status -eq 200) "$($map.Status)"
Check-Fields $map.Json.data @("eventSlug", "catalogVersionId", "zones", "locations", "routeGraph") "MapResponse"

# 8. assistant
$chat = Invoke-Call "POST" "/api/v1/events/$Slug/assistant" $token @{ message = "what is next on my route?" }
Check "POST /assistant returns 200" ($chat.Status -eq 200) "$($chat.Status) $($chat.Raw.Substring(0,[Math]::Min(200,$chat.Raw.Length)))"
Check-Fields $chat.Json.data @("message", "intent", "tool", "confidence", "needsClarification", "sources", "warnings", "clock") "AssistantResponse"

# 9. replan preview
$replan = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary/replan" $token @{ decision = "preview" }
Check "POST /replan returns 200" ($replan.Status -eq 200) "$($replan.Status)"
Check "replan mode is in declared enum" (@("APPLIED", "PROPOSED", "DISMISSED", "NO_CHANGE") -contains $replan.Json.data.mode) "$($replan.Json.data.mode)"
Check-Fields $replan.Json.data @("mode", "itineraryId", "itinerary", "diff", "nowMinute", "clock") "ReplanResponse"

# 9b. idempotent replan: same key + same body must replay the same proposal/decision
$replanKey = [guid]::NewGuid().ToString()
$replanFirst = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary/replan" $token @{ decision = "preview" } @{ "idempotency-key" = $replanKey }
$replanSecond = Invoke-Call "POST" "/api/v1/events/$Slug/itinerary/replan" $token @{ decision = "preview" } @{ "idempotency-key" = $replanKey }
Check "idempotent replan returns 200 twice" ($replanFirst.Status -eq 200 -and $replanSecond.Status -eq 200) "$($replanFirst.Status)/$($replanSecond.Status)"
Check "idempotent replan replays the same mode and proposal" (($replanFirst.Json.data.mode -eq $replanSecond.Json.data.mode) -and ($replanFirst.Json.data.proposalId -eq $replanSecond.Json.data.proposalId)) "$($replanFirst.Json.data.mode)/$($replanFirst.Json.data.proposalId) vs $($replanSecond.Json.data.mode)/$($replanSecond.Json.data.proposalId)"
Check "idempotent replan sets Idempotent-Replay: true" ((Get-HeaderValue $replanSecond.HeadersRaw "idempotent-replay") -eq "true") (Get-HeaderValue $replanSecond.HeadersRaw "idempotent-replay")

# 10. analytics
$metric = Invoke-Call "POST" "/api/v1/events/$Slug/analytics" $token @{ metricName = "activity_viewed"; metricValue = 1 }
Check "POST /analytics returns 202" ($metric.Status -eq 202) "$($metric.Status)"
Check-Fields $metric.Json.data @("accepted", "id", "bucketStart") "analytics ack"

# 11. delete session
$del = Invoke-Call "DELETE" "/api/v1/events/$Slug/session" $token $null
Check "DELETE /session returns 200 deleted:true" ($del.Status -eq 200 -and $del.Json.data.deleted -eq $true) "$($del.Status)"
$after = Invoke-Call "GET" "/api/v1/events/$Slug/itinerary" $token $null
Check "deleted session is rejected on reuse" ($after.Status -eq 401 -or $after.Status -eq 404) "$($after.Status)"

$failed = 0
foreach ($r in $results) {
  if ($r.ok) { Write-Host ("PASS  " + $r.name) } else { Write-Host ("FAIL  " + $r.name + "  -> " + $r.detail); $failed++ }
}
Write-Host ""
Write-Host ("$($results.Count - $failed)/$($results.Count) contract checks passed")
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
if ($failed -gt 0) { exit 1 }
