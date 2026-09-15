nCore Web Addon – Javított változat
================================

Ez a projekt a Thsandorh/nCore-addon repó forkja:
https://github.com/Thsandorh/nCore-addon

Az eredeti projekt nCore keresésre és TorBox alapú streamelésre készült Stremio addon. Ez a változat saját javításokat és módosításokat tartalmaz.

FŐBB MÓDOSÍTÁSOK
----------------
- TorBox torrent-forwarding / resolve folyamat javítása.
- TorBox globális cache ellenőrzésének javítása.
- A TorBox cache találatok alapján a már elérhető torrentek előnyben részesítése.
- Személyes konfiguráció kezelése tokenen keresztül.
- A konfiguráció AES-256-GCM titkosítással, szerveroldali titkos kulccsal védett.
- A személyes manifest URL tartalmazza a konfigurációhoz szükséges titkosított tokent.
- A /<token>/configure útvonal támogatása, így egy már létrehozott konfiguráció szerkesztési oldala ugyanahhoz a manifesthez kapcsolódhat.
- Docker és Docker Compose támogatás.
- GHCR/Docker build workflow támogatás.
- A konfigurációs secret külön környezeti változóban kezelhető.
- A projekt verziója 1.3.

SZÜKSÉGES
---------
- nCore fiók
- TorBox fiók és API-kulcs
- Docker + Docker Compose, ha konténerben futtatod
- Saját szerver vagy VPS, amely folyamatosan elérhető
- HTTPS ajánlott, különösen interneten keresztüli használatnál

GYORS TELEPÍTÉS DOCKERREL
-------------------------
1. Klónozd a repót:

   git clone git@github.com:Taur1/nCore-addon-javitott.git
   cd nCore-addon

2. Hozd létre a .env fájlt:

   NCORE_CONFIG_SECRET=IDE_EGY_HOSSZU_VELETLEN_TITKOS_KULCS

A secret legyen hosszú és véletlenszerű. Ne töltsd fel GitHubra.

3. Indítsd el:

   docker compose up -d --build

4. Ellenőrizd:

   docker ps
   curl http://127.0.0.1:3005/health

Siker esetén:

   {"ok":true}

KONFIGURÁCIÓ
------------
Nyisd meg:

   https://SAJAT-DOMAIN/configure

Add meg:
- nCore felhasználóneved
- nCore jelszavad
- TorBox API-kulcsod

A rendszer létrehozza a személyes manifest URL-t. Ezt telepítsd Stremióba az „Install in Stremio” lehetőséggel, vagy add hozzá manuálisan.

FONTOS BIZTONSÁGI INFORMÁCIÓ
----------------------------
A konfigurációs adatok nem adatbázisban vannak tárolva.

A konfiguráció AES-256-GCM titkosítással kerül tokenbe, a titkosításhoz pedig a szerver NCORE_CONFIG_SECRET értéke szükséges.

A manifest URL személyes hozzáférési adatnak tekintendő. Ne oszd meg másokkal.

A .env és az NCORE_CONFIG_SECRET soha ne kerüljön GitHubra.

REVERSE PROXY / DOMAIN
----------------------
Ha reverse proxy, Cloudflare Tunnel vagy más proxy mögött futtatod, az alkalmazás külső HTTPS URL-je legyen elérhető.

Példa:

   https://ncore-addon.example.com/configure

A Stremio számára generált manifest URL ugyanerről a domainről fog származni.

PORT
----
A Docker Compose alapértelmezett beállítása:

   3005:3000

A szerver 3005-ös portja kerül továbbításra a konténer 3000-es portjára.

VERZIÓ
------
Jelenlegi verzió: 1.3

FORRÁS ÉS EREDET
----------------
Alap projekt:
https://github.com/Thsandorh/nCore-addon

Módosított fork:
https://github.com/Taur1/nCore-addon-javitott

A módosított változat fő célja a TorBox integráció, a cache-kezelés, a tokenes konfiguráció és a Dockeres telepítés javítása.

MEGJEGYZÉS
----------
Az addon használatához érvényes nCore és TorBox hozzáférés szükséges. A projekt saját szerveren történő futtatásra készült.
