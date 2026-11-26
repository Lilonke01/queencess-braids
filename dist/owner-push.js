"use strict";

const pushEnable = document.querySelector("#enable-push");
const pushDisable = document.querySelector("#disable-push");
const pushTest = document.querySelector("#test-push");
const pushFeedback = document.querySelector("#push-feedback");
let pushConfig;
let pushDeviceId;
const supportsPush = () => isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function subscriptionId(subscription) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(subscription.endpoint));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function pushBusy(busy) {
  for(const button of [pushEnable,pushDisable,pushTest]) button.disabled=busy;
}
async function loadPushSettings() {
  const key=ownerKey;
  pushEnable.hidden=false;pushTest.hidden=true;pushDisable.hidden=true;
  if(!supportsPush()) {
    pushEnable.disabled=true;
    pushFeedback.textContent="This browser does not support push alerts. Open this website in Chrome on your Android phone.";
    return;
  }
  try {
    const config=await api("/api/owner/push",{key});
    if(key!==ownerKey) return;
    pushConfig=config;
    pushEnable.disabled=!config.configured;
    if(!config.configured) {pushFeedback.textContent="Booking alerts are being configured. Try again later.";return;}
    const registration=await navigator.serviceWorker.getRegistration("/");
    const subscription=await registration?.pushManager.getSubscription();
    const id=subscription?await subscriptionId(subscription):null;
    const device=config.devices.find(device=>device.id===id);
    pushDeviceId=device?.id;
    const active=Boolean(device)&&Notification.permission==="granted";
    pushEnable.hidden=active;pushTest.hidden=!active;pushDisable.hidden=!device;
    if(Notification.permission==="denied") {
      pushEnable.disabled=true;
      pushFeedback.textContent="Notifications are blocked. In Android Chrome, open this site's permissions, allow notifications, then reload this page.";
    } else if(active) {
      pushFeedback.textContent=device.lastError?"Alerts are enabled, but the last attempt failed. Try Send test alert.":"Booking alerts are enabled on this device. Use Send test alert to check your phone's notification settings.";
    } else pushFeedback.textContent="Tap Enable booking alerts, then choose Allow in the browser prompt.";
  } catch(error) {if(key===ownerKey)pushFeedback.textContent=error.message;}
}

pushEnable.addEventListener("click",async()=>{
  const key=ownerKey;
  if(!key||!pushConfig?.configured||!supportsPush()) return;
  pushBusy(true);
  try {
    const permission=await Notification.requestPermission();
    if(permission!=="granted") throw new Error("Alerts were not enabled. Choose Allow in this site's notification permissions to receive booking alerts.");
    if(key!==ownerKey) return;
    const registration=await navigator.serviceWorker.register("/owner-sw.js",{scope:"/"});
    await navigator.serviceWorker.ready;
    const raw=atob(pushConfig.publicKey.replace(/-/g,"+").replace(/_/g,"/"));
    const publicKey=Uint8Array.from(raw,char=>char.charCodeAt(0));
    let subscription=await registration.pushManager.getSubscription();
    if(subscription?.options.applicationServerKey && [...new Uint8Array(subscription.options.applicationServerKey)].join()!==[...publicKey].join()) {
      await subscription.unsubscribe();subscription=null;
    }
    subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
    await api("/api/owner/push",{method:"POST",key,data:{endpoint:subscription.endpoint}});
    await loadPushSettings();
  } catch(error) {if(key===ownerKey)pushFeedback.textContent=error.message;}
  finally {pushBusy(false);if(Notification.permission==="denied")pushEnable.disabled=true;}
});
pushDisable.addEventListener("click",async()=>{
  const key=ownerKey;if(!key||!pushDeviceId)return;
  pushBusy(true);
  try {
    await api("/api/owner/push",{method:"DELETE",key,data:{id:pushDeviceId}});
    const registration=await navigator.serviceWorker.getRegistration("/");
    const subscription=await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    await loadPushSettings();
    if(key===ownerKey)pushFeedback.textContent="Booking alerts are disabled on this device.";
  } catch(error) {if(key===ownerKey)pushFeedback.textContent=error.message;}
  finally {pushBusy(false);}
});
pushTest.addEventListener("click",async()=>{
  const key=ownerKey;if(!key||!pushDeviceId)return;
  pushBusy(true);pushFeedback.textContent="Sending test alert…";
  try {
    await api("/api/owner/push/test",{method:"POST",key,data:{id:pushDeviceId}});
    if(key===ownerKey)pushFeedback.textContent="The push service accepted your test. If it does not appear, check Android notification settings and internet access.";
  } catch(error) {if(key===ownerKey)pushFeedback.textContent=error.message;}
  finally {pushBusy(false);}
});
