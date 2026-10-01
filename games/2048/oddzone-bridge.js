(()=>{
  function stopInput(event){
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  window.__oddzoneReadScore=()=>Number(window.__oddzoneGame?.score||0);
  window.__oddzoneStart=()=>window.__oddzoneGame?.restart();
  window.__oddzoneEnd=()=>{
    window.__oddzoneEnded=true;
    document.addEventListener('keydown',stopInput,true);
    document.addEventListener('touchstart',stopInput,true);
    document.addEventListener('touchend',stopInput,true);
    document.addEventListener('pointerdown',stopInput,true);
  };
})();
