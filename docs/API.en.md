# SmartCity API to manage the city from an external program

The simulation runs on a server (`npm run serve` or `docker compose up -d --build`) and the REST API lets an external
program (yours, in any language) **read** the state of the city, **download the history** and **change** things: close
streets, adjust traffic signals, move buses, limit the access of cars, etc.

Everything here exists and is tested (`test/management.test.js`, `test/server.test.js`). A working example manager is in
[`examples/gestor.py`](https://github.com/prubioamzubiri/SmartCity/blob/main/examples/gestor.py).

## Connection

| | |
| --- | --- |
| URL | `http://localhost:8080` (`npm run serve`) · `http://localhost` / `https://<domain>` (Docker, the proxy forwards `/api`) |
| Reads (`GET`) | Public |
| Writes (`POST`, `PUT`, `PATCH`, `DELETE`) | Header `Authorization: Bearer <SMARTCITY_TOKEN>` if the server has a token (in `.env`). Without a token, anyone can write |
| Format | JSON (`Content-Type: application/json`). Errors: `{"error": "message"}` with 400 (invalid data), 401 (token), 403 (blocked action), 404, 413 or 422 |
| This guide | In the viewer: **Connection** tab or **Data → Open the API guide**. On the server: `GET /api/docs` (web page) and `GET /api/docs.md` (Markdown) |

### Simulated time

The city has its own clock: **1 real second = 52.1 simulated seconds** (one real week = one simulated year) and it keeps
running even if nobody is connected. `GET /api/state` gives `simTime` (simulated ISO time), `simSeconds` and `scale`.
The dates of the history (`from`, `to`) are simulated times (`2026-01-05T00:00`, `from` included and `to` excluded).
Between two decisions of your program, for example, 5 real seconds ≈ 4.3 simulated minutes go by.

### Coordinates

Points are given in **metres from the origin of the map** (`x` towards the east, `z` towards the south) or in **`lat`
and `lon`** (equivalent; the origin is 43.3183, −1.9812). The endpoints that ask for a point accept either form.

---

## 1. Reading the state now

### `GET /api/state` — summary of the whole city

Main fields: `simTime`, `scale`, `caughtUp`, `cars` (cars on the road), `params` (`maxCars`, `maxPedestrians`,
`scenario`), `traffic` (`stopped` stopped cars, `avgKmh` average speed), `signalPlan`, `sensors` and
`pedestrianSensors` (with the accumulated `total` and `current`), `parkings` (`id`, `name`, `capacity`, `occupancy` from
0 to 1, `tracked`), `pedestrians.expected` (pedestrians on the street), `pedestrians.meanWaitSeconds` (average wait of
whoever arrives to cross at a junction with signals: more with a longer cycle or a very uneven split) and
`pedestrians.waitingAtSignals` (people waiting now at those junctions), `buses.lines` (`id`, `fleet`, `suspended`,
`tracked`), `bikes` (`inUse` and `stations` with `available`, `capacity`, `pending`), `weather`, `holiday`, `events`,
`restrictions` (the active ones, as in `GET /api/restrictions`), `seed` (the seed of this city), `startSeconds` (when it
started), `lang` (the language of the service), `writeProtected` (changes need a token) and `records` (rows stored by
kind).

### `GET /api/point?x=&z=&radius=` — what is near a point, right now

`radius` in metres (1–2000, default 50). It returns `cars` (`count`, `stopped`, `avgKmh`), `pedestrians.count`, `buses`
(`count`, `passengers`) and `signals`: the nearby signals with a cycle and their state. It is the quick way to know «how
many cars / pedestrians there are at X» without creating sensors.

```sh
curl "http://localhost:8080/api/point?lat=43.3166&lon=-1.9800&radius=200"
```

### Buses — `GET /api/buses`

Per line (`id` = `L1`…): `fleet` (assigned buses already running), `target` (the assigned ones counting those on the way
from the depot), `pending` (the ones on the way: `[{count, readyAt}]`, see §3.3), `minFleet`/`maxFleet`, `capacity`
(seats per bus), `active` (in service now), `passengers` (on board), `full` (full buses), `waiting` (people waiting at the
stops), `leftBehind` (people who wanted to get on the buses now at a stop and did not fit), `suspended` (route cut, see
§3) and `tracked`. And for the whole city: `fleetTotal` (buses the city has), `reserve` (those not assigned to any line),
`deployMinutes` (how long an added bus takes to enter service) and `today` (bus hours in service on the simulated day:
`busHours`, `includedHours` —those the initial fleet would do— and `overtimeHours`, the extra ones). Occupancy of a line
= `passengers / (active × capacity)`. `GET /api/buses/<line>` gives the same for one line plus its route: `stops`, the
stops in order with their coordinates `x`, `z` (to know, for example, which lines pass near the venue of an event).

How many people want to take the bus depends on the hour, the day, the **rain** (quite a lot more people), the
**events** (before they start, the lines passing near the venue fill up; when they end, everybody leaves at once from
the nearby stops) and the **closed streets** (fewer cars and more people on the bus). With more buses on a line they
come more often: people wait less and fewer get on each one. Whoever does not fit or gets tired of waiting **takes the
car**: a bad bus service fills the streets.

### Bikes — `GET /api/bikes`

`inUse` and, per station: `id`, `name`, `x`, `z`, `capacity` (docks), `available` (free bikes), `pending` (capacity
change on the way). Free docks = `capacity − available`. They are estimates of the simulator, not real sensors. Also
`vans` (the redistribution vans: `id`, position `x`/`z`, `busy` and the current job, `job`, with `from`, `to`, `bikes`,
`loaded` and the times `loadAt`/`unloadAt`) and `moved` (bikes moved by van).

On working days there is a **tide**: in the morning (7–10 h) bikes are taken in the neighbourhoods and left in the centre,
and in the evening (17–20 h) the other way round. The neighbourhood stations empty and those in the centre fill up every
day at similar times.

### Car parks

`parkings` in `GET /api/state`: current occupancy (`occupancy`) and price (`price`, €/h) of each underground car park.
Cars arrive with the demand of the city and the **nearby events**, stay about 2 h and leave. Whoever goes to park chooses
among the car parks within 1 km **by price**: one dearer than its neighbours sends them cars and a cheaper one takes them.
If the chosen one is full they try those around, and if they find no space they **drive around looking**
(`parking_search` in `city.csv`): more cars on the street.

### Traffic signals — `GET /api/signals`

Lists the signals that regulate traffic (`?all=1` also includes pedestrian crossings; `?x=&z=&radius=` filters by area).
Each one: `id`, `x`, `z`, `mode`, `state` (`ew` = east-west axis, `ns` = north-south: `green`/`yellow`/`red`), `timing`
(`greenEw`, `greenNs`, `yellow`, `cycle` in seconds), `override` (own settings, or `null`) and, like the loops of a real
junction, the **detector** of each axis: `approaching` (cars less than 100 m from the stop line) and `queue` (how many of
them are stopped). `GET /api/signals/<id>` returns a single one.

### Streets — `GET /api/roads?x=&z=&radius=&limit=`

Streets passing less than `radius` m (1–1000, default 100) from the point, from the nearest to the furthest (`limit`
1–100, default 20). Each one: `way` (**street identifier**, used to close it), `class` (`motorway`, `primary`,
`secondary`, `tertiary`, `residential`), `oneway`, `length` (m), `from`/`to` (ends), `cars` (cars right now) and
`distance` to the point. `GET /api/roads/<way>` returns one.

### Others

`GET /api/weather` (weather and 48 h forecast), `GET /api/events` (events), `GET /api/holidays` (holidays),
`GET /api/cars` and `GET /api/pedestrians` (positions, for drawing). They are useful as input variables of a model.
`GET /api/health` answers `{"ok": true}` if the server is running (to check the connection).

---

## 2. History

The history comes as CSV. For traffic, car parks, pedestrians, buses and bikes **only the points you have enabled are
recorded**, and **from the moment you enable them** (there is no earlier past): enable them at the start.

| What | How to enable it | Download |
| --- | --- | --- |
| Cars at a point | `POST /api/sensors` `{x, z, name}` → `id` (`S1`…). Also `PATCH`/`DELETE /api/sensors/<id>` | `GET /api/traffic.csv?from=&to=&id=` (every 5 min: `count`, `count_fwd`, `count_bwd`, `avg_speed_kmh`) |
| Pedestrians at a point | `POST /api/pedestrian-sensors` `{x, z, name}` → `id` (`P1`…). Also `PATCH`/`DELETE /api/pedestrian-sensors/<id>` | `GET /api/pedestrians.csv?from=&to=&id=` (`count`, `count_walk`, `count_cross`, `present`) |
| Car park occupancy | `PUT /api/parking/tracked` `{"ids": ["U-125_53", …]}` | `GET /api/parking.csv?from=&to=&id=` |
| Buses per line | `PUT /api/buses/tracked` `{"ids": ["L1", …]}` | `GET /api/buses.csv?from=&to=&id=` (every 5 min: `buses`, `passengers`, `capacity`, `occupancy_pct`, `full_buses`, `waiting`, `left_behind`, `fleet` —assigned buses already running— and `unserved` —people left without a bus because it was full or they got tired of waiting; steadier than `left_behind`, which only looks at the buses now at a stop—) |
| Bikes per station | `PUT /api/bikes/tracked` `{"ids": ["municipal/0", …]}` | `GET /api/bikes.csv?from=&to=&id=` (every 15 min: `bikes`, `free_docks`, `takes`, `returns`, `occupancy_pct`) |
| The whole city | — (always on, since the server starts) | `GET /api/city.csv?from=&to=` (every 5 min: `cars`, `stopped`, `avg_speed_kmh`, `buses`, `bus_passengers`, `full_buses`, `bus_waiting`, `suspended_lines`, `bikes_in_use`, `stations_empty`, `stations_full`, `parkings_full` (full car parks), metres of street `closed_m` / `bus_only_m` / `limited_m`, `signals_all_red` and the trips of the interval: `trips_done`, `trip_min` (average duration), `delay_min` (average delay compared with travelling without traffic or closures) and `trips_lost`; `bus_unserved`, the people who wanted to take the bus and could not; `bus_demand`, the people who want to take the bus (per hour); `ped_wait_s` and `ped_waiting`, the average wait and the people waiting at junctions with signals —crossing a street closed to cars has no wait—; and `ped_space`, the space won by pedestrians: km of street closed to cars × how busy it is × the people on the street; bus only counts 70 %; `parking_search`, cars driving around because they find no space in a car park; and `parking_premium`, how much dearer than the base price the car parks are, on average) |
| Weather, events | — (always available, also for the past) | `GET /api/weather.csv`, `GET /api/events.csv` |

Column names and codes are the same in every language; the `weekday` column comes in the language of the service.
Each `PUT …/tracked` **replaces** the previous list: send all the ids you want to record.

```sh
curl -o traffic.csv "http://localhost:8080/api/traffic.csv?from=2026-01-05T00:00&to=2026-02-01T00:00"
```

---

## 3. Changing the city (needs the token)

### 3.1 Closing streets and restricting access — `/api/restrictions`

A **restriction** is defined by a **circular zone** (`x`, `z` or `lat`, `lon`, and `radius` from 1 to 1000 m; it affects
all the sections passing inside the circle) or by **specific streets** (`ways`: list of ids from `GET /api/roads`, up to
200). There are three modes:

| `mode` | Effect |
| --- | --- |
| `pedestrians_only` | Street closed, **pedestrians only**: neither cars **nor buses** pass |
| `buses_and_pedestrians` | **Buses and pedestrians only**: cars cannot pass; buses can |
| `entry_limit` | **Access restricted to new vehicles**: outside cars only enter the zone while there are fewer than `limit` inside (`limit: 0` = none enters; those inside can leave) |

| Request | Description |
| --- | --- |
| `POST /api/restrictions` `{mode, x, z, radius \| ways, limit?, name?}` | Creates one (up to 100 at a time). Returns `201` and the restriction with its `id` (`R1`…) |
| `GET /api/restrictions` | Lists the active ones: `id`, `mode`, `area`/`ways`, `limit`, `edges`, `length` (metres of street affected), `cars` (cars inside now) and `suspendedLines` |
| `GET /api/restrictions/<id>` | One restriction |
| `PATCH /api/restrictions/<id>` `{mode?, limit?, name?}` | Changes the mode, the limit or the name (the zone cannot be changed: delete it and create another) |
| `DELETE /api/restrictions/<id>` | Removes it: the street reopens |

```sh
# 1. Find streets near a point
curl "http://localhost:8080/api/roads?lat=43.3166&lon=-1.9800&radius=60&limit=3"
# 2. Close the street with `way` 2325 to everything except buses and pedestrians
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"buses_and_pedestrians","ways":[2325],"name":"Pedestrian street with bus"}'
# 3. Zone that cars can only enter while there are fewer than 10 inside
curl -X POST http://localhost:8080/api/restrictions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"entry_limit","lat":43.3166,"lon":-1.98,"radius":300,"limit":10}'
```

How the simulator behaves:

- When a restriction is created, the cars that were on a closed section **reappear elsewhere** in the city and all of
  them recompute their route. New cars do not appear on closed sections or in `entry_limit` zones.
- **Buses follow a fixed route**: if a street of their route is closed with `pedestrians_only`, that **line is
  suspended** (`suspended: true`, no buses, and people pile up at the stops). With `buses_and_pedestrians` the line keeps
  running. Buses do not take detours.
- `entry_limit` with a `limit` above 0 is approximate: cars choose their route a few streets ahead, so there can be a
  few more than the limit.
- **Cars make trips**: each one goes from its origin to a destination zone along the fastest way and, on arrival, starts
  another trip. Closing streets makes trips longer (the delay goes up) and, if the destination is left without a way,
  the trip cannot be made (`trips_lost` in `GET /api/city.csv`). Cars that were on a section that gets closed lose their
  trip.
- **Pedestrians are not affected by closures**: they always walk on the pavements. The difference between
  `pedestrians_only` and `buses_and_pedestrians` lies in the buses.
- Restrictions are stored and **survive server restarts**.

### 3.2 Traffic signals — `PATCH /api/signals/<id>`

The `id` comes from `GET /api/signals`. Fields (all optional; those you do not send are kept, `null` removes an own
setting, `{"reset": true}` deletes all the settings of the signal):

| Field | Values |
| --- | --- |
| `mode` | `normal` (cycle) · `off` (switched off) or `flashing` (flashing amber): unregulated junction (see below) · `all_red`: everybody stops |
| `green` | Seconds of green of both axes (5–180) |
| `greenA` / `greenB` | Green of the east-west / north-south axis separately (5–180) |
| `yellow` | Seconds of amber (3–6: for safety, it cannot go below 3) |
| `schedule` | List (up to 20) of rules with a timetable: `[{"when": {"start": "07:00", "end": "09:00", "weekdays": [1,2,3,4,5]}, "greenA": 40}]`. `when` accepts `start`/`end` (HH:MM, together), `weekdays` (0 = Sunday), `months`, `daysOfMonth`, `years` and `dates` (YYYY-MM-DD) |

```sh
curl -X PATCH http://localhost:8080/api/signals/13965274528 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"mode":"normal","greenA":45,"greenB":15}'
```

Each phase change **loses time**: when the green of an axis starts, the first 2 seconds are still red for everybody
(clearing the junction and starting off). That is why a very short cycle lets fewer cars through and forms queues at the
rush hour; a very long one makes everybody wait longer. The best green depends on how much traffic there is.

`PUT /api/signals/plan` `{"plan": {"default": {...}, "signals": {"<id>": {...}}}}` replaces **the whole** plan at once
(same fields; `default` applies to all the signals without their own settings). Settings are stored and survive
restarts.

A signal **switched off** (`off`) or **flashing amber** (`flashing`) leaves the junction **unregulated** (in both modes
its state in `GET /api/signals` is `uncontrolled`):

- All cars arrive slowly (~15 km/h) and **give way** if a car comes along the street with priority (the higher class
  one; with the same class, the east-west axis).
- **Pedestrians** cross in groups and cars wait; the more people there are on the street, the longer the crossing is
  busy. **With flashing amber the pedestrian has priority** (crosses on arrival: the crossing is busy quite a bit more);
  **switched off**, they cross when there is a gap (the crossing is busy less, cars stop less).

With little traffic (at night) it can save waits; at the rush hour it forms queues. Switching off all signals at the
rush hour brings the city to a standstill.

At **zebra crossings without signals** the same happens as with the pedestrians of an unregulated junction: they cross
in groups and cars stop while they cross (unless it is too late to brake). They cross more often the more people there
are on the street and the busier the street of the crossing is (shops, stops…); in the small hours they hardly slow
traffic down. At a crossing less than 40 m from a signal they cross on the cars' red.

### 3.3 Buses of a line — `PATCH /api/buses/<line>`

`{"fleet": 12}` sets the number of buses of the line (`L1`…) between `minFleet` and `maxFleet` (1–30) and is kept after a
restart. **Removing is immediate** (they go back to the depot), but **added buses take `deployMinutes` (40 simulated
min) to enter service**: they leave the depot and appear in `pending` with their arrival time (`readyAt`). To have them in
time for the rush hour or an event you have to ask for them **in advance**. If fewer are asked for while buses are on
the way, those are cancelled first. How many run at a time also depends on the demand of the hour (`active` in
`GET /api/buses`): with low demand only part of the fleet goes out.

Bus hours in service cost: those of the initial fleet are included, but **the extra ones are overtime**
(`today.overtimeHours`) and get dearer the more of them pile up in a day. Reinforce when and where it is needed, not all
day.

The **total fleet is fixed**: the city has the initial buses of all lines plus a 10 % reserve (`fleetTotal`). They can be
shared out among the lines as you wish, but no more can be added: to give a line buses you have to take them from the
reserve (`reserve`) or from another line first. If there are not enough, it answers `409`.

```sh
curl -X PATCH http://localhost:8080/api/buses/L1 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"fleet":12}'
```

### 3.4 Bikes — `PUT /api/bikes/capacity`

`{"changes": {"municipal/0": 20, "municipal/5": null}}` changes the docks (1–60) of several stations (all or nothing);
`null` cancels a pending change. **It takes 30 simulated days** (about 14 real hours) to apply; in the meantime it shows
in `pending`.

### 3.5 Bikes — `POST /api/bikes/moves`

`{"from": "municipal/3", "to": "municipal/17", "bikes": 15}` asks a **van** (there are 3, of 20 bikes) to move bikes from
one station to another. The nearest free one goes to the origin, loads what is there (at most `bikes`), goes to the
destination and unloads what fits. **Each trip takes time**: about 15 min to load, another 15 to unload and the drive
(≈15 km/h). It answers `201` with the van and the loading and unloading times (`loadAt`, `unloadAt`), or `409` if none is
free. To have bikes where they are needed at the rush hour you have to move them **in advance**: when the station is
already empty, you are late. Vans travel in a straight line (they do not follow the streets or the traffic). In the
viewer: **Bikes → Vans** tab (and on the map, the vans F1–F3 in orange).

### 3.6 Tariff of a car park — `PATCH /api/parking/<id>`

`{"price": 3}` schedules **tomorrow's tariff** of a car park (€/h, between 0.5 and 6; default 2; `null` goes back to the
default). It can have **time bands** with another price (at most 4):
`{"price": 2, "schedule": [{"from": "17:00", "to": "22:00", "price": 4}]}`. As in a real city, **the tariff only changes
at 0:00** and stays the same on the following days until it is changed: you have to decide today the one for tomorrow,
knowing what kind of day it will be (working day or holiday, events, weather forecast). `parkings` in `GET /api/state`
has the current price (`price`), today's tariff (`today`) and the one scheduled for tomorrow (`tomorrow`). In the viewer:
**Car parks → Change tomorrow's tariff** (and above each P on the map, the current price).

Whoever goes to park chooses among the car parks of their area by price: one dearer than its neighbours sends them cars
and a cheaper one takes them. Raising all of them at once does not change which car park people go to, but it **does
change how many come by car**: with expensive car parks (on average), some people leave the car and take the bus, the
bike or walk (all at twice the price: 7.5 % fewer cars; at most 15 %). Buses fill up more and there are more people on
the streets and at the signals; and high prices count as a **cost of the intervention** for the citizens. People going
to an **event** look at the car parks around the venue (less than 800 m away): at twice the price, 30 % of them leave the
car (at most half) and take the event's bus lines. `parking_premium` in `city.csv`: how much dearer than the base price
they are, on average (0 = at the base price; 1 = twice as much).

```sh
curl -X PATCH http://localhost:8080/api/parking/U-125_53 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"price": 2, "schedule": [{"from": "17:00", "to": "22:00", "price": 4}]}'
```

### 3.7 The demand is not controlled

How many cars and pedestrians there are in the city **cannot be changed**: the server sets it (`params` in
`GET /api/state`: `maxCars` and `maxPedestrians` at the peak) and it **varies a little at random** every day (±10 %) and
from hour to hour (±5 %), as in a real city. `PUT /api/params` answers `403`. You have to predict it with the history,
not set it. What you do **does change it indirectly**: with closed streets there are fewer cars and more people on the
bus, and if the buses cannot cope (people left behind or very long waits) some of those people take the car.

---

### 3.8 The city chatbot — `/api/chat`

The city has a chatbot that appears in the viewer (bottom right) **when you enable it**. At first it is hidden and,
without an engine, it always answers «I don't know»: you provide the «brain». It is configured with the token, from the
configuration page (`chatadmin/` in the repository: a separate container, on port 8095) or from your program:

```sh
curl -X PUT http://localhost:8080/api/chat/config -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": true, "title": "Txiki", "provider": "custom", "url": "http://our-server:5000/chat", "includeState": true}'
```

| Field | What it is |
| --- | --- |
| `enabled` | `true` = it appears in the viewer |
| `title` | name in the viewer |
| `provider` | `none` («I don't know»), `ollama`, `openai` (any compatible API: OpenAI, LM Studio, vLLM...) or `custom` (your service) |
| `url` | address of the engine **as seen from the city** (the city is the one that calls it). `custom`: the full URL |
| `model`, `apiKey` | model and key (the key is never returned; `null` keeps the saved one) |
| `systemPrompt` | instructions of the assistant |
| `includeState` | add the current state of the city (time, traffic, weather, events) |
| `temperature`, `maxTokens`, `timeoutSeconds` | settings of the answer |

The default name and instructions are in the language of the service (`SMARTCITY_LANG`): the assistant answers in that
language unless you change the instructions. With `custom`, the city sends your URL `POST {"messages": [...],
"instructions": "...", "city": "..." | null}` and expects `{"reply": "text"}` (with `apiKey`, it arrives as
`Authorization: Bearer`). `GET /api/chat/config` gives the configuration; `POST /api/chat/test`
`{"messages": [...], "config": {...}}` tries a configuration without saving it; `POST /api/chat/models` lists the models
of the engine and `POST /api/chat/pull` `{"model": "llama3.2"}` downloads one into Ollama. Anyone (the viewer) asks with
`POST /api/chat` `{"messages": [{"role": "user", "content": "..."}]}` → `{"reply": "..."}` (10 questions per minute;
`chat.enabled` in `GET /api/state` says whether it is enabled).

## What CANNOT be done (yet)

The simulator does not model congestion charging, air quality or emissions, and parking spaces, the route or the
frequency of the lines cannot be changed (only their number of buses). There is no history of the actions already taken
either: store them yourselves if you want to evaluate them.

## Making an autonomous manager

The typical loop is: **read** (`/api/state`, `/api/point`, `/api/buses`, `/api/bikes`…) → **decide** (rules, a model
trained with the CSV files, reinforcement learning…) → **act** (`/api/restrictions`, `/api/signals/<id>`,
`/api/buses/<line>`…) → wait and measure the effect. Start with `examples/gestor.py`:

```sh
SMARTCITY_URL=http://localhost SMARTCITY_TOKEN=... python3 examples/gestor.py
```

Tips: the state changes by itself (there is more traffic at the rush hour, it rains, there are events), so compare with
what would happen without acting and not just «before/after»; make one change at a time to know what caused it; and
avoid oscillations (closing and reopening every few seconds).
