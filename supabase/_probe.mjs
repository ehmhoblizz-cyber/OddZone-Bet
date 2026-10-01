const U='https://csrfrzzpduhhzldirdfi.supabase.co';
const K='sb_publishable_y_aWz0kwtbJYAcWfVNqGCg_CH4L3MHj';
const H={apikey:K,Authorization:`Bearer ${K}`};
const cols={profiles:['id','username','email','wallet_balance','is_verified','kyc_type','avatar_url','created_at','updated_at','bank_code'],
stake_challenges:['id','user_id','game_id','stake','payout','score','status','opponent_id','refund_amount','created_at'],
bets:['id','user_id','game_id','game','game_title','score','stake','payout','status','opponent_id','winner_id','creator_score','opponent_score'],
pending_bets:['id','user_id','game_id','stake','payout','status','creator_score','opponent_score'],
transactions:['id','user_id','title','type','amount','detail','reference','status','created_at']};
for(const [t,cs] of Object.entries(cols)){
  console.log('\n=== '+t+' ===');
  for(const c of cs){
    const r=await fetch(`${U}/rest/v1/${t}?select=${c}&limit=1`,{headers:H});
    if(r.ok) console.log(`  ${c}: OK`);
    else { const b=await r.text(); console.log(`  ${c}: ${b.replace(/\s+/g,' ').slice(0,140)}`); }
  }
  const all=await fetch(`${U}/rest/v1/${t}?select=*&limit=1`,{headers:H});
  console.log(`  select=* -> ${all.status} ${all.ok?(await all.text()).slice(0,400):(await all.text()).replace(/\s+/g,' ').slice(0,160)}`);
}
for(const fn of ['open_duel','settle_duel','cancel_duel','wallet_balance','record_deposit','ensure_profile']){
  const r=await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:{...H,'Content-Type':'application/json'},body:'{}'});
  console.log(`\nrpc ${fn} -> ${r.status} ${(await r.text()).replace(/\s+/g,' ').slice(0,200)}`);
}