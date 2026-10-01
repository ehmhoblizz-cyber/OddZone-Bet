(()=>{
  function stopInput(event){event.preventDefault();event.stopImmediatePropagation()}
  window.__oddzoneReadScore=()=>Number(window.score||0);
  window.__oddzoneStart=()=>{if(window.gameState===0&&typeof window.startBtnHandler==='function')window.startBtnHandler()};
  window.__oddzoneEnd=()=>{
    if(window.gameState===1&&typeof window.pause==='function')window.pause();
    window.canRestart=0;
    document.addEventListener('keydown',stopInput,true);
    document.addEventListener('touchstart',stopInput,true);
    document.addEventListener('mousedown',stopInput,true);
  };
})();
