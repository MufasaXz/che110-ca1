(function(){
  var btn=document.querySelector(".nav-toggle"),nav=document.getElementById("nav-menu");
  function set(o){nav.classList.toggle("open",o);btn.setAttribute("aria-expanded",o)}
  btn.addEventListener("click",function(){set(!nav.classList.contains("open"))});
  nav.addEventListener("click",function(e){if(e.target.tagName==="A")set(false)});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")set(false)});
  var els=document.querySelectorAll(".section .container > *, .finding");
  els.forEach(function(el){el.classList.add("reveal")});
  if(!("IntersectionObserver" in window)){els.forEach(function(el){el.classList.add("in")});return}
  var io=new IntersectionObserver(function(list){list.forEach(function(x){if(x.isIntersecting){x.target.classList.add("in");io.unobserve(x.target)}})},{threshold:.1});
  els.forEach(function(el){io.observe(el)});
})();
