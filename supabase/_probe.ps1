# Probe the live database shape with the publishable key only.
$u='https://csrfrzzpduhhzldirdfi.supabase.co'
$k='sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj'
$H=@{apikey=$k; Authorization="Bearer $k"}

function Probe($label,$url){
  try{
    $r=Invoke-WebRequest $url -Headers $H -UseBasicParsing -TimeoutSec 20
    "$label -> $($r.StatusCode) $($r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))"
  } catch {
    $b=$null
    try{ $s=$_.Exception.Response.GetResponseStream(); $b=(New-Object IO.StreamReader($s)).ReadToEnd() }catch{}
    "$label -> ERR $($_.Exception.Message) :: $($b -replace '\s+',' ')"
  }
}

$tables=@('profiles','stake_challenges','bets','pending_bets','transactions')
foreach($t in $tables){ Probe "table $t (select *)" "$u/rest/v1/$t?select=*&limit=1" }
''
foreach($c in @('id','user_id','wallet_balance','is_verified','game_id','stake','payout','score','creator_score','opponent_score','status','title','detail','amount','reference','opponent_id','winner_id','refund_amount')){
  Probe "stake_challenges.$c" "$u/rest/v1/stake_challenges?select=$c&limit=1"
}
''
Probe 'rpc open_duel' "$u/rest/v1/rpc/open_duel"
Probe 'rpc wallet_balance' "$u/rest/v1/rpc/wallet_balance"