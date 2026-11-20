# SmartCity APIa hiria kanpoko programa batetik kudeatzeko

Simulazioa zerbitzari batean dabil (`npm run serve` edo `docker compose up -d --build`), eta REST APIari esker kanpoko
programa batek (zuena, nahi duzuen lengoaian) hiriaren egoera **irakurri**, **historikoak deskargatu** eta gauzak
**aldatu** ditzake: kaleak itxi, semaforoak doitu, autobusak mugitu, autoen sarbidea mugatu, etab.

Hemen agertzen den guztia badago eta probatuta dago (`test/management.test.js`, `test/server.test.js`). Kudeatzaile
adibide bat, funtzionatzen duena, [`examples/gestor.py`](https://github.com/prubioamzubiri/SmartCity/blob/main/examples/gestor.py) fitxategian dago.

## Konexioa

| | |
| --- | --- |
| URLa | `http://localhost:8080` (`npm run serve`) · `http://localhost` / `https://<domeinua>` (Docker, proxyak `/api` birbidaltzen du) |
| Irakurketak (`GET`) | Publikoak |
| Idazketak (`POST`, `PUT`, `PATCH`, `DELETE`) | `Authorization: Bearer <SMARTCITY_TOKEN>` goiburua, zerbitzariak tokena badu (`.env` fitxategian). Tokenik gabe, edonork idatz dezake |
| Formatua | JSON (`Content-Type: application/json`). Erroreak: `{"error": "mezua"}`, 400 (datu baliogabeak), 401 (tokena), 403 (ekintza blokeatua), 404, 413 edo 422 kodeekin |
| Gida hau | Ikustailean: **Konexioa** fitxa edo **Datuak → Ireki APIaren gida**. Zerbitzarian: `GET /api/docs` (web orria) eta `GET /api/docs.md` (Markdown) |

### Denbora simulatua

Hiriak bere erlojua du: **benetako segundo 1 = 52,1 segundo simulatu** (benetako aste bat = urte simulatu bat), eta inor
konektatuta ez badago ere martxan jarraitzen du. `GET /api/state`-k `simTime` (ISO ordu simulatua), `simSeconds` eta
`scale` ematen ditu. Historikoen datak (`from`, `to`) ordu simulatuak dira (`2026-01-05T00:00`, `from` barne eta `to`
kanpo). Zuen programaren bi erabakiren artean, adibidez, benetako 5 s ≈ 4,3 min simulatu igarotzen dira.

### Koordenatuak

Puntuak **maparen jatorritik metrotan** ematen dira (`x` ekialderantz, `z` hegoalderantz) edo **`lat` eta `lon`**
erabiliz (baliokideak dira; jatorria 43.3183, −1.9812 da). Puntu bat eskatzen duten endpointek bi moduak onartzen dituzte.

---

## 1. Oraingo egoera irakurri

### `GET /api/state` — hiri osoaren laburpena

Eremu nagusiak: `simTime`, `scale`, `caughtUp`, `cars` (zirkulatzen ari diren autoak), `params` (`maxCars`,
`maxPedestrians`, `scenario`), `traffic` (`stopped` geldirik dauden autoak, `avgKmh` batez besteko abiadura),
`signalPlan`, `sensors` eta `pedestrianSensors` (`total` metatuarekin eta `current`-ekin), `parkings` (`id`, `name`,
`capacity`, `occupancy` 0tik 1era, `tracked`), `pedestrians.expected` (oinezkoak kalean), `pedestrians.meanWaitSeconds`
(semaforodun bidegurutze batean zeharkatzera iristen denaren batez besteko itxaronaldia: handiagoa ziklo luzeago batekin
edo banaketa oso desorekatu batekin) eta `pedestrians.waitingAtSignals` (bidegurutze horietan orain zain dagoen jendea),
`buses.lines` (`id`, `fleet`, `suspended`, `tracked`), `bikes` (`inUse` eta `stations`, `available`, `capacity` eta
`pending`-ekin), `weather`, `holiday`, `events`, `restrictions` (aktiboak, `GET /api/restrictions`-en bezala), `seed`
(hiri honen hazia), `startSeconds` (noiz hasi zen), `lang` (zerbitzuaren hizkuntza), `writeProtected` (aldaketek tokena
behar dute) eta `records` (motaren arabera gordetako errenkadak).

### `GET /api/point?x=&z=&radius=` — zer dagoen puntu batetik gertu, oraintxe

`radius` metrotan (1–2000, lehenetsia 50). `cars` (`count`, `stopped`, `avgKmh`), `pedestrians.count`, `buses`
(`count`, `passengers`) eta `signals` itzultzen ditu: inguruko ziklodun semaforoak, beren egoerarekin. «X lekuan zenbat
auto / oinezko dauden» jakiteko modu azkarra da, sentsorerik sortu gabe.

```sh
curl "http://localhost:8080/api/point?lat=43.3166&lon=-1.9800&radius=200"
```

### Autobusak — `GET /api/buses`

Linea bakoitzeko (`id` = `L1`…): `fleet` (esleitutako autobusak, dagoeneko zirkulatzen dutenak), `target` (esleitutakoak,
garajetik bidean daudenak barne), `pending` (bidean daudenak: `[{count, readyAt}]`, ikus §3.3), `minFleet`/`maxFleet`,
`capacity` (autobus bakoitzeko plazak), `active` (orain zerbitzuan), `passengers` (barruan), `full` (autobus beteak),
`waiting` (geltokietan zain dagoen jendea), `leftBehind` (orain geltoki batean dauden autobusetara igo nahi eta sartu ez
den jendea), `suspended` (ibilbidea moztuta, ikus §3) eta `tracked`. Gainera, hiri osorako: `fleetTotal` (hiriak dituen
autobusak), `reserve` (inongo lineari esleitu gabeak), `deployMinutes` (gehitzen den autobus batek zerbitzuan sartzeko
behar duena) eta `today` (egun simulatuko zerbitzuko autobus-orduak: `busHours`, `includedHours` —hasierako flotak
egingo lituzkeenak— eta `overtimeHours`, gehiegizkoak). Linea baten okupazioa = `passengers / (active × capacity)`.
`GET /api/buses/<linea>`-k gauza bera ematen du linea baterako, eta gainera bere ibilbidea: `stops`, geltokiak ordenan
beren `x`, `z` koordenatuekin (adibidez, ekitaldi baten egoitzatik gertu zein linea pasatzen diren jakiteko).

Autobusez zenbat jendek joan nahi duen orduaren, egunaren, **euriaren** (jende dezente gehiago), **ekitaldien** (hasi
aurretik, egoitzatik gertu pasatzen diren lineak betetzen dira; amaitzean, denak batera ateratzen dira inguruko
geltokietatik) eta **itxitako kaleen** (auto gutxiago eta jende gehiago autobusean) araberakoa da. Linea batean autobus
gehiagorekin maizago pasatzen dira: gutxiago itxaroten da eta jende gutxiago igotzen da bakoitzera. Sartzen ez dena edo
itxaroteaz nekatzen dena **autoa hartzen du**: autobus-zerbitzu txar batek kaleak betetzen ditu.

### Bizikletak — `GET /api/bikes`

`inUse` eta, geltoki bakoitzeko: `id`, `name`, `x`, `z`, `capacity` (ainguraguneak), `available` (bizikleta libreak),
`pending` (bidean dagoen edukiera-aldaketa). Ainguragune libreak = `capacity − available`. Simulagailuaren estimazioak
dira, ez benetako sentsoreak. Gainera, `vans` (birbanaketa-furgonetak: `id`, `x`/`z` posizioa, `busy` eta uneko lana,
`job`, `from`, `to`, `bikes`, `loaded` eta `loadAt`/`unloadAt` orduekin) eta `moved` (furgonetaz mugitutako bizikletak).

Lanegunetan **marea** dago: goizean (7–10 h) auzoetan hartzen dira bizikletak eta erdigunean uzten, eta arratsaldean
(17–20 h), alderantziz. Auzoetako geltokiak hustu eta erdigunekoak betetzen dira egunero antzeko orduetan.

### Aparkalekuak

`GET /api/state`-ko `parkings`: lurpeko aparkaleku bakoitzaren uneko okupazioa (`occupancy`) eta prezioa (`price`, €/h).
Autoak hiriko eskariaren eta **inguruko ekitaldien** arabera iristen dira, 2 h inguru geratzen dira eta joan egiten dira.
Aparkatzera doanak 1 km baino gutxiagora dauden aparkalekuen artean aukeratzen du **prezioaren arabera**: bere
auzokideak baino garestiagoa denak autoak bidaltzen dizkie, eta merkeagoak kendu egiten dizkie. Aukeratutakoa beteta
badago, ingurukoetan saiatzen da, eta lekurik aurkitzen ez badu **bueltaka ibiltzen da bila** (`parking_search`
`city.csv`-n): auto gehiago kalean.

### Semaforoak — `GET /api/signals`

Trafikoa arautzen duten semaforoak zerrendatzen ditu (`?all=1`-ek oinezkoen pasabideak ere sartzen ditu;
`?x=&z=&radius=`-k eremuz iragazten du). Bakoitza: `id`, `x`, `z`, `mode`, `state` (`ew` = ekialde-mendebalde ardatza,
`ns` = ipar-hegoa: `green`/`yellow`/`red`), `timing` (`greenEw`, `greenNs`, `yellow`, `cycle` segundotan), `override`
(doikuntza propioak, edo `null`) eta, benetako bidegurutze bateko espirak bezala, ardatz bakoitzaren **detektagailua**:
`approaching` (gelditze-lerrotik 100 m baino gutxiagora dauden autoak) eta `queue` (horietatik zenbat dauden geldirik).
`GET /api/signals/<id>`-k bakarra itzultzen du.

### Kaleak — `GET /api/roads?x=&z=&radius=&limit=`

Puntutik `radius` m baino gutxiagora (1–1000, lehenetsia 100) pasatzen diren kaleak, hurbilenetik urrunenera (`limit`
1–100, lehenetsia 20). Bakoitza: `way` (**kalearen identifikatzailea**, ixteko erabiltzen da), `class` (`motorway`,
`primary`, `secondary`, `tertiary`, `residential`), `oneway`, `length` (m), `from`/`to` (muturrak), `cars` (oraintxe
dauden autoak) eta puntura arteko `distance`. `GET /api/roads/<way>`-k bat itzultzen du.

### Beste batzuk

`GET /api/weather` (eguraldia eta 48 orduko iragarpena), `GET /api/events` (ekitaldiak), `GET /api/holidays` (jaiegunak),
`GET /api/cars` eta `GET /api/pedestrians` (posizioak, marrazteko). Eredu baten sarrera-aldagai gisa erabilgarriak dira.
`GET /api/health`-ek `{"ok": true}` erantzuten du zerbitzaria martxan badago (konexioa egiaztatzeko).

---

## 2. Historikoak

Historikoak CSV fitxategiak dira. Trafikoa, aparkalekuak, oinezkoak, autobusak eta bizikletentzat **aktibatu dituzuen
puntuak bakarrik grabatzen dira**, eta **aktibatzen dituzuenetik aurrera** (ez dago aurreko iraganik): aktiba itzazue
hastean.

| Zer | Nola aktibatu | Deskargatu |
| --- | --- | --- |
| Autoak puntu batean | `POST /api/sensors` `{x, z, name}` → `id` (`S1`…). Baita `PATCH`/`DELETE /api/sensors/<id>` ere | `GET /api/traffic.csv?from=&to=&id=` (5 minutuz behin: `count`, `count_fwd`, `count_bwd`, `avg_speed_kmh`) |
| Oinezkoak puntu batean | `POST /api/pedestrian-sensors` `{x, z, name}` → `id` (`P1`…). Baita `PATCH`/`DELETE /api/pedestrian-sensors/<id>` ere | `GET /api/pedestrians.csv?from=&to=&id=` (`count`, `count_walk`, `count_cross`, `present`) |
| Aparkalekuen okupazioa | `PUT /api/parking/tracked` `{"ids": ["U-125_53", …]}` | `GET /api/parking.csv?from=&to=&id=` |
| Autobusak linea bakoitzeko | `PUT /api/buses/tracked` `{"ids": ["L1", …]}` | `GET /api/buses.csv?from=&to=&id=` (5 minutuz behin: `buses`, `passengers`, `capacity`, `occupancy_pct`, `full_buses`, `waiting`, `left_behind`, `fleet` —esleitutako autobusak, dagoeneko zirkulatzen dutenak— eta `unserved` —autobusik gabe geratu den jendea, sartzen ez zelako edo itxaroteaz nekatu delako; `left_behind` baino egonkorragoa, geltoki batean dauden autobusei bakarrik begiratzen baitie—) |
| Bizikletak geltoki bakoitzeko | `PUT /api/bikes/tracked` `{"ids": ["municipal/0", …]}` | `GET /api/bikes.csv?from=&to=&id=` (15 minutuz behin: `bikes`, `free_docks`, `takes`, `returns`, `occupancy_pct`) |
| Hiri osoa | — (beti aktibo, zerbitzaria abiatzen denetik) | `GET /api/city.csv?from=&to=` (5 minutuz behin: `cars`, `stopped`, `avg_speed_kmh`, `buses`, `bus_passengers`, `full_buses`, `bus_waiting`, `suspended_lines`, `bikes_in_use`, `stations_empty`, `stations_full`, `parkings_full` (aparkaleku beteak), kale-metroak `closed_m` / `bus_only_m` / `limited_m`, `signals_all_red` eta tarteko bidaiak: `trips_done`, `trip_min` (batez besteko iraupena), `delay_min` (batez besteko atzerapena, trafikorik eta itxierarik gabe joatearekin alderatuta) eta `trips_lost`; `bus_unserved`, autobusez joan nahi eta ezin izan duen jendea; `bus_demand`, autobusez joan nahi duen jendea (orduko); `ped_wait_s` eta `ped_waiting`, semaforodun bidegurutzeetako batez besteko itxaronaldia eta zain dagoen jendea —autoentzat itxitako kale bat zeharkatzeak ez du itxaronaldirik—; eta `ped_space`, oinezkoek irabazitako espazioa: autoentzat itxitako kale-km × zenbat jende ibiltzen den bertan × kalean dagoen jendea; autobusa bakarrik % 70 zenbatzen da; `parking_search`, aparkaleku batean lekurik aurkitzen ez dutelako bueltaka dabiltzan autoak; eta `parking_premium`, aparkalekuak oinarrizko prezioa baino zenbat garestiago dauden, batez beste) |
| Eguraldia, ekitaldiak | — (beti erabilgarri, iraganekoak ere bai) | `GET /api/weather.csv`, `GET /api/events.csv` |

Zutabeen izenak eta kodeak berdinak dira hizkuntza guztietan; `weekday` zutabea zerbitzuaren hizkuntzan dator.
`PUT …/tracked` bakoitzak aurreko zerrenda **ordezkatzen** du: bidali grabatu nahi dituzuen id guztiak.

```sh
curl -o trafikoa.csv "http://localhost:8080/api/traffic.csv?from=2026-01-05T00:00&to=2026-02-01T00:00"
```

---

## 3. Hiria aldatu (tokena behar da)

### 3.1 Kaleak itxi eta sarbidea murriztu — `/api/restrictions`

**Murrizketa** bat **eremu zirkular** batek (`x`, `z` edo `lat`, `lon`, eta `radius` 1etik 1000 m-ra; zirkuluaren
barrutik pasatzen diren tarte guztiei eragiten die) edo **kale zehatzek** (`ways`: `GET /api/roads`-eko id-en zerrenda,
gehienez 200) definitzen dute. Hiru modu daude:

| `mode` | Eragina |
| --- | --- |
| `pedestrians_only` | Kalea itxita, **oinezkoak bakarrik**: ez dira pasatzen ez autoak **ez autobusak** |
| `buses_and_pedestrians` | **Autobusak eta oinezkoak bakarrik**: autoak ez dira pasatzen; autobusak bai |
| `entry_limit` | **Ibilgailu berrientzako sarbide mugatua**: kanpoko autoak eremuan barruan `limit` baino gutxiago daudenean bakarrik sartzen dira (`limit: 0` = ez da bat ere sartzen; barrukoak irten daitezke) |

| Eskaera | Deskribapena |
| --- | --- |
| `POST /api/restrictions` `{mode, x, z, radius \| ways, limit?, name?}` | Bat sortzen du (gehienez 100 aldi berean). `201` itzultzen du eta murrizketa bere `id`-arekin (`R1`…) |
| `GET /api/restrictions` | Aktiboak zerrendatzen ditu: `id`, `mode`, `area`/`ways`, `limit`, `edges`, `length` (eragindako kale-metroak), `cars` (orain barruan dauden autoak) eta `suspendedLines` |
| `GET /api/restrictions/<id>` | Murrizketa bat |
| `PATCH /api/restrictions/<id>` `{mode?, limit?, name?}` | Modua, muga edo izena aldatzen ditu (eremua ezin da aldatu: ezabatu eta sortu beste bat) |
| `DELETE /api/restrictions/<id>` | Kendu egiten du: kalea berriro irekitzen da |

```sh
# 1. Puntu batetik gertuko kaleak bilatu
curl "http://localhost:8080/api/roads?lat=43.3166&lon=-1.9800&radius=60&limit=3"
# 2. 2325 `way`-a duen kalea itxi, autobusak eta oinezkoak izan ezik
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"buses_and_pedestrians","ways":[2325],"name":"Oinezkoen kalea autobusarekin"}'
# 3. Barruan 10 baino gutxiago dauden bitartean bakarrik autoak sar daitezkeen eremua
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"entry_limit","lat":43.3166,"lon":-1.98,"radius":300,"limit":10}'
```

Simulagailuak nola jokatzen duen:

- Murrizketa bat sortzean, itxitako tarte batean zeuden autoak **hiriko beste puntu batean agertzen dira berriro** eta
  guztiek beren ibilbidea birkalkulatzen dute. Auto berriak ez dira agertzen itxitako tarteetan ezta `entry_limit`
  eremuetan ere.
- **Autobusek ibilbide finkoa dute**: beren ibilbideko kale bat `pedestrians_only`-rekin ixten bada, **linea hori
  etenda geratzen da** (`suspended: true`, autobusik gabe, eta jendea geltokietan pilatzen da).
  `buses_and_pedestrians`-ekin lineak funtzionatzen jarraitzen du. Autobusek ez dute desbideratzerik egiten.
- 0 baino handiagoko `limit` duen `entry_limit` gutxi gorabeherakoa da: autoek kale batzuk aurretik aukeratzen dute
  ibilbidea, beraz mugatik gora batzuk gehiago egon daitezke.
- **Autoek bidaiak egiten dituzte**: bakoitza bere jatorritik helmuga-eremu batera doa biderik azkarrenetik eta,
  iristean, beste bidaia bat hasten du. Kaleak ixteak bidaiak luzatzen ditu (atzerapena igotzen da) eta, helmuga biderik
  gabe geratzen bada, bidaia ezin da egin (`trips_lost` `GET /api/city.csv`-n). Ixten den tarte batean zeuden autoek
  beren bidaia galtzen dute.
- **Oinezkoei ez diete itxierek eragiten**: beti espaloietatik ibiltzen dira. `pedestrians_only` eta
  `buses_and_pedestrians` arteko aldea autobusetan dago.
- Murrizketak gorde egiten dira eta **zerbitzariaren berrabiarazteak gainditzen dituzte**.

### 3.2 Semaforoak — `PATCH /api/signals/<id>`

`id`-a `GET /api/signals`-etik dator. Eremuak (guztiak aukerakoak; bidaltzen ez dituzuenak mantendu egiten dira, `null`-ek
doikuntza propio bat kentzen du, `{"reset": true}`-k semaforoaren doikuntza guztiak ezabatzen ditu):

| Eremua | Balioak |
| --- | --- |
| `mode` | `normal` (zikloa) · `off` (itzalita) edo `flashing` (anbar keinukaria): arautu gabeko bidegurutzea (ikus behean) · `all_red`: denak gelditzen dira |
| `green` | Bi ardatzen berde-segundoak (5–180) |
| `greenA` / `greenB` | Ekialde-mendebalde / ipar-hego ardatzaren berdea bereizita (5–180) |
| `yellow` | Anbar-segundoak (3–6: segurtasunagatik, ezin da 3tik jaitsi) |
| `schedule` | Ordutegidun arauen zerrenda (gehienez 20): `[{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]`. `when`-ek onartzen ditu `start`/`end` (OO:MM, elkarrekin), `weekdays` (0 = igandea), `months`, `daysOfMonth`, `years` eta `dates` (UUUU-HH-EE) |

```sh
curl -X PATCH http://localhost:8080/api/signals/13965274528 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"normal","greenA":45,"greenB":15}'
```

Fase-aldaketa bakoitzak **denbora galtzen du**: ardatz baten berdea hastean, lehen 2 segundoak gorrian jarraitzen dute
denentzat (bidegurutzea hustu eta abiatzeko). Horregatik, ziklo oso labur batek auto gutxiago pasatzen uzten ditu eta
puntako orduan ilarak sortzen ditu; oso luze batek denak gehiago itxaronarazten ditu. Berderik onena zenbat trafiko
dagoen araberakoa da.

`PUT /api/signals/plan` `{"plan": {"default": {...}, "signals": {"<id>": {...}}}}`-k plan **osoa** ordezkatzen du batera
(eremu berak; `default` doikuntza propiorik gabeko semaforo guztiei aplikatzen zaie). Doikuntzak gorde egiten dira eta
berrabiarazteak gainditzen dituzte.

**Itzalitako** semaforo batek (`off`) edo **anbar keinukarian** dagoenak (`flashing`) bidegurutzea **arautu gabe** uzten
du (bi moduetan bere egoera `GET /api/signals`-en `uncontrolled` da):

- Auto guztiak poliki iristen dira (~15 km/h) eta **bidea uzten dute** lehentasuna duen kaletik auto bat badator
  (kategoria handiagokoa; kategoria berean, ekialde-mendebalde ardatza).
- **Oinezkoek** taldeka zeharkatzen dute eta autoek itxaron egiten dute; zenbat eta jende gehiago egon kalean, orduan
  eta denbora gehiago dago pasabidea okupatuta. **Anbar keinukarian oinezkoak du lehentasuna** (iritsi bezain laster
  zeharkatzen du: pasabidea dezente gehiago dago okupatuta); **itzalita**, tartea dagoenean zeharkatzen du (pasabidea
  gutxiago okupatzen da, autoak gutxiago gelditzen dira).

Trafiko gutxirekin (gauez) itxaronaldiak aurrez ditzake; puntako orduan ilarak sortzen ditu. Puntako orduan semaforo
guztiak itzaltzeak hiria blokeatzen du.

**Semafororik gabeko zebra-bideetan** arautu gabeko bidegurutze bateko oinezkoekin bezala gertatzen da: taldeka
zeharkatzen dute eta autoak gelditu egiten dira zeharkatzen duten bitartean (balaztatzeko denborarik ez badute izan
ezik). Zenbat eta jende gehiago egon kalean eta pasabideko kalea zenbat eta jendetsuagoa izan (dendak, geltokiak…),
orduan eta maizago zeharkatzen dute; goizaldean ia ez dute trafikoa moteltzen. Semaforo batetik 40 m baino gutxiagora
dagoen pasabide batean autoen gorriarekin zeharkatzen dute.

### 3.3 Linea baten autobusak — `PATCH /api/buses/<linea>`

`{"fleet": 12}`-k linearen (`L1`…) autobus kopurua finkatzen du `minFleet` eta `maxFleet` artean (1–30), eta
berrabiarazi ondoren mantentzen da. **Kentzea berehalakoa da** (garajera itzultzen dira), baina **gehitzen direnek
`deployMinutes` (40 min simulatu) behar dituzte zerbitzuan sartzeko**: garajetik ateratzen dira eta `pending`-en agertzen
dira iristeko orduarekin (`readyAt`). Puntako orduan edo ekitaldi batean garaiz izateko, **aurretik** eskatu behar dira.
Bidean autobusak dauden bitartean gutxiago eskatzen badira, horiek bertan behera uzten dira lehenik. Aldi berean zenbat
dabiltzan orduko eskariaren araberakoa ere bada (`active` `GET /api/buses`-en): eskari gutxirekin flotaren zati bat
bakarrik ateratzen da.

Zerbitzuko autobus-orduek kostua dute: hasierako flotarenak barne daude, baina **gehiegizkoak gainkostua dira**
(`today.overtimeHours`), eta egunean zenbat eta gehiago pilatu, orduan eta garestiagoak dira. Behar den unean eta lekuan
indartzea komeni da, ez egun osoan.

**Flota osoa finkoa da**: hiriak linea guztien hasierako autobusak ditu gehi % 10eko erreserba (`fleetTotal`). Lineen
artean nahi bezala bana daitezke, baina ezin da gehiago gehitu: linea bati autobusak emateko, erreserbatik (`reserve`)
hartu behar dira edo lehenik beste bati kendu. Nahikoa ez badago, `409` erantzuten du.

```sh
curl -X PATCH http://localhost:8080/api/buses/L1 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"fleet":12}'
```

### 3.4 Bizikletak — `PUT /api/bikes/capacity`

`{"changes": {"municipal/0": 20, "municipal/5": null}}`-k hainbat geltokiren ainguraguneak (1–60) aldatzen ditu (dena
edo ezer ez); `null`-ek zain dagoen aldaketa bat bertan behera uzten du. **30 egun simulatu behar ditu** (benetako 14 h
inguru) aplikatzeko; bitartean `pending`-en agertzen da.

### 3.5 Bizikletak — `POST /api/bikes/moves`

`{"from": "municipal/3", "to": "municipal/17", "bikes": 15}`-k **furgoneta** bati (3 daude, 20 bizikletakoak)
bizikletak geltoki batetik bestera mugitzeko eskatzen dio. Gertuen dagoen libreak jatorrira joaten da, dauden bizikletak
kargatzen ditu (gehienez `bikes`), helmugara joaten da eta sartzen direnak deskargatzen ditu. **Bidaia bakoitzak denbora
behar du**: 15 min inguru kargatzeko, beste 15 deskargatzeko eta bidaia (≈15 km/h). `201` erantzuten du furgonetarekin
eta karga- eta deskarga-orduekin (`loadAt`, `unloadAt`), edo `409` bat ere libre ez badago. Puntako orduan behar diren
lekuan bizikletak izateko, **aurretik** mugitu behar dira: geltokia dagoeneko hutsik dagoenean, berandu da. Furgonetak
lerro zuzenean doaz (ez dituzte kaleak ez trafikoa jarraitzen). Ikustailean: **Bizikletak → Furgonetak** fitxa (eta
mapan, F1–F3 furgonetak laranjaz).

### 3.6 Aparkaleku baten tarifa — `PATCH /api/parking/<id>`

`{"price": 3}`-k aparkaleku baten **biharko tarifa** programatzen du (€/h, 0,5 eta 6 artean; lehenetsia 2; `null`-ek
lehenetsira itzultzen du). Beste prezio bat duten **ordu-tarteak** izan ditzake (gehienez 4):
`{"price": 2, "schedule": [{"from": "17:00", "to": "22:00", "price": 4}]}`. Benetako hiri batean bezala, **tarifa
0:00etan bakarrik aldatzen da** eta hurrengo egunetan berdin jarraitzen du aldatu arte: gaur erabaki behar da biharkoa,
zer egun izango den jakinda (lanegun edo jaiegun, ekitaldiak, eguraldiaren iragarpena). `GET /api/state`-ko
`parkings`-en oraingo prezioa (`price`), gaurko tarifa (`today`) eta biharko programatua (`tomorrow`) agertzen dira.
Ikustailean: **Aparkalekuak → Aldatu biharko tarifa** (eta mapako P bakoitzaren gainean, oraingo prezioa).

Aparkatzera doanak bere eremuko aparkalekuen artean aukeratzen du prezioaren arabera: bere auzokideak baino
garestiagoa denak autoak bidaltzen dizkie eta merkeagoak kendu egiten dizkie. Guztiak batera igotzeak ez du aldatzen
jendea zein aparkalekutara doan, baina **bai zenbat joaten diren autoz**: aparkaleku garestiekin (batez beste),
jendearen zati batek autoa uzten du eta autobusez, bizikletaz edo oinez joaten da (denak bikoitzean, % 7,5 auto
gutxiago; gehienez % 15). Autobusak gehiago betetzen dira eta jende gehiago dago kaleetan eta semaforoetan; eta prezio
altuak **esku-hartzearen kostu** gisa zenbatzen dira herritarrentzat. **Ekitaldi** batera doazenek egoitza inguruko
aparkalekuei begiratzen diete (800 m baino gutxiagora): prezio bikoitzarekin, % 30ek autoa uzten du (gehienez erdiak) eta
ekitaldiko autobus-lineetan joaten da. `parking_premium` `city.csv`-n: oinarrizko prezioa baino zenbat garestiago
dauden, batez beste (0 = oinarrizko prezioan; 1 = bikoitza).

```sh
curl -X PATCH http://localhost:8080/api/parking/U-125_53 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"price": 2, "schedule": [{"from": "17:00", "to": "22:00", "price": 4}]}'
```

### 3.7 Eskaria ez da kontrolatzen

Hirian zenbat auto eta oinezko dauden **ezin da aldatu**: zerbitzariak finkatzen du (`GET /api/state`-ko `params`:
`maxCars` eta `maxPedestrians` puntako orduan) eta **apur bat aldatzen da ausaz** egunero (±% 10) eta orduz ordu (±% 5),
benetako hiri batean bezala. `PUT /api/params`-ek `403` erantzuten du. Historikoekin aurreikusi behar da, ez finkatu.
Egiten duzuenak **zeharka aldatzen du**: itxitako kaleekin auto gutxiago eta jende gehiago dago autobusean, eta
autobusak nahikoa ez badira (jendea lurrean edo itxaronaldi oso luzeak) jende horren zati batek autoa hartzen du.

---

## Ezin dena egin (oraindik)

Simulagailuak ez ditu modelatzen pilaketa-tasak, airearen kalitatea ezta isurketak ere, eta ezin dira aldatu
aparkaleku-plazak, ezta lineen ibilbidea edo maiztasuna ere (beren autobus kopurua bakarrik). Ez dago dagoeneko
aplikatutako ekintzen historikorik ere: gorde itzazue zuek ebaluatu nahi badituzue.

## Kudeatzaile autonomo bat egin

Ziklo arrunta hau da: **irakurri** (`/api/state`, `/api/point`, `/api/buses`, `/api/bikes`…) → **erabaki** (arauak, CSV
fitxategiekin entrenatutako eredu bat, indartze bidezko ikaskuntza…) → **jardun** (`/api/restrictions`,
`/api/signals/<id>`, `/api/buses/<linea>`…) → itxaron eta eragina neurtu. Hasi `examples/gestor.py`-rekin:

```sh
SMARTCITY_URL=http://localhost SMARTCITY_TOKEN=... python3 examples/gestor.py
```

Aholkuak: egoera berez aldatzen da (puntako orduan trafiko gehiago dago, euria egiten du, ekitaldiak daude), beraz
alderatu ezer egin gabe gertatuko litzatekeenarekin eta ez bakarrik «aurretik/ondoren»; egin aldaketa bat aldi bakoitzean
zerk eragin duen jakiteko; eta saihestu gorabeherak (ixtea eta berriro irekitzea segundo gutxian behin).
