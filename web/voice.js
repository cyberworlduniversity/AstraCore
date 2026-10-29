(() => {
  const KEY='astracore.voice.v1';
  const get=()=>{try{return {...{enabled:false,rate:1,pitch:1,autoSpeak:false},...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {enabled:false,rate:1,pitch:1,autoSpeak:false}}};
  let S=get(); let recognition=null;
  const save=()=>localStorage.setItem(KEY,JSON.stringify(S));
  function toast(t){const old=document.querySelector('.voice-toast');if(old)old.remove();const e=document.createElement('div');e.className='voice-toast';e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),1600)}
  function speak(text){if(!S.enabled||!('speechSynthesis' in window)||!text)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=Number(S.rate)||1;u.pitch=Number(S.pitch)||1;speechSynthesis.speak(u)}
  function stop(){if('speechSynthesis' in window)speechSynthesis.cancel()}
  function startListening(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast('Voice input is not supported in this browser');return}if(recognition){recognition.stop();recognition=null;return}recognition=new SR();recognition.lang=S.language||'en-IN';recognition.interimResults=true;recognition.continuous=false;recognition.onresult=e=>{let text='';for(const r of e.results)text+=r[0].transcript;const input=document.getElementById('message');if(input){input.value=text;input.dispatchEvent(new Event('input'));input.focus()}};recognition.onerror=()=>toast('Voice input stopped');recognition.onend=()=>{recognition=null;const b=document.getElementById('voiceInputBtn');if(b)b.classList.remove('active')};recognition.start();const b=document.getElementById('voiceInputBtn');if(b)b.classList.add('active');toast('Listening…')}
  function addControls(){const composer=document.getElementById('composer');if(!composer||document.getElementById('voiceInputBtn'))return;const row=composer.querySelector('.composer-top');const b=document.createElement('button');b.type='button';b.id='voiceInputBtn';b.className='tool-btn';b.title='Voice input';b.setAttribute('aria-label','Voice input');b.textContent='🎙';b.addEventListener('click',startListening);row.insertBefore(b,document.getElementById('sendBtn'));
    const stopBtn=document.createElement('button');stopBtn.type='button';stopBtn.className='tool-btn';stopBtn.title='Stop speaking';stopBtn.setAttribute('aria-label','Stop speaking');stopBtn.textContent='🔇';stopBtn.addEventListener('click',stop);row.insertBefore(stopBtn,document.getElementById('sendBtn'));
  }
  window.AstraVoice={get:()=>({...S}),set:(k,v)=>{S[k]=v;save()},speak,stop,startListening,refresh:addControls};
  window.addEventListener('DOMContentLoaded',addControls);
})();
