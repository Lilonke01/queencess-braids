"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil(self.registration.showNotification("Queencess booking alert", {
    body: "Open your owner dashboard to check new appointment requests.",
    icon: "/queencess-logo.png",
    tag: "queencess-bookings",
    renotify: true,
    data: {url: "/owner.html#customer-bookings"},
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url=new URL("/owner.html#customer-bookings",self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async windows=>{
    for(const client of windows) {
      if(client.url.startsWith(self.location.origin+"/owner")) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
