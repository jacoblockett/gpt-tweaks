"use strict";
/* Web Audio requires a DOM, which MV3 service workers do not provide. */
let audioContext=null;
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=="gpt-tweaks:notification:sound"||
     message.target!=="offscreen")return false;
  (async()=>{
    if(!audioContext)audioContext=new AudioContext();
    if(audioContext.state!=="running")await audioContext.resume();
    const start=audioContext.currentTime+0.01;
    for(const [i,frequency] of [740,988].entries()){
      const begin=start+i*0.14;
      const oscillator=audioContext.createOscillator();
      const gain=audioContext.createGain();
      oscillator.type="sine";
      oscillator.frequency.setValueAtTime(frequency,begin);
      gain.gain.setValueAtTime(0.0001,begin);
      gain.gain.exponentialRampToValueAtTime(0.09,begin+0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001,begin+0.22);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(begin);
      oscillator.stop(begin+0.23);
    }
    return {ok:true};
  })().then(respond,error=>respond({ok:false,error:String(error)}));
  return true;
});