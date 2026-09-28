# TODO

## Şablon takip butonu yazılmadan önce ZORUNLU

- [ ] `sendTemplate()` çağrısına, o hasta için `recordInboundMessage()`'a verilen **aynı thread anahtarı** verilmeli (`options.threadKey`). Anahtar farklı yazılırsa (`905…` / `+905…` / `whatsapp:+905…`) yeni inbound mesaj `followupTemplateSentAt` işaretini sıfırlamaz ve thread bir sonraki sessizlik döneminde takip mesajı alamaz; son inbound zamanı da bulunamayacağı için gönderim `BLOCKED_NO_INBOUND_HISTORY` ile reddedilir.
- [ ] Operatör takip butonu için UI henüz yok. `sendTemplate()`'in şu an hiçbir çağıranı yok; tetikleyici (inbox'taki buton ve onu çağıran API route) yazılmalı. Route inbox oturum koruması ve access audit log kapsamında olmalı.

## Kabul edilen kararlar

- **Etkin şablon süresi 72 saat.** Son inbound zamanı 3 × `COMPLIANCE_WINDOW_HOURS` (varsayılan 72 saat) saklanıyor; bu kayıt silinince şablon `BLOCKED_NO_INBOUND_HISTORY` ile reddedilir. `TEMPLATE_MAX_AGE_DAYS` (varsayılan 30) yalnızca bundan daha sıkı bir üst sınır olarak işler. `followupTemplateSentAt` işaretinin TTL'i inbound kaydının kalan ömrü + 1 saat; ikisi aynı sabitten (`getInboundRetentionMs()`) türetiliyor.
- **Belirsiz hatada işaret korunur.** Ağ hatası veya timeout gibi, şablonun gidip gitmediği bilinmeyen durumlarda işaret silinmez. Olası bir tekrar gönderim yerine olası bir kaçan takip tercih edildi. Gate reddi, Meta'nın non-2xx cevabı ve eksik kimlik bilgisi "kesin gönderilmedi" sayılır ve işaret bırakılır.
- **Redis yokken çoklu instance'ta teorik çift gönderim riski.** İşaret Redis'te `SET NX` ile atomik. Redis yapılandırılmamışsa ya da hata veriyorsa bellek içi yedek devreye girer; bu yalnızca tek süreç içinde atomiktir. Aynı anda birden fazla instance çalışırken iki çağrı iki şablon gönderebilir.
- **Sessizlik dönemi başına bir takip.** Hasta her yazdığında işaret sıfırlanır; bir sonraki sessizlikte yeniden bir takip mümkündür. Toplam bir üst sınır yoktur (ör. "30 günde en fazla N şablon" uygulanmıyor).
