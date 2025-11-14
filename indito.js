const express = require('express');
const path = require('path');
const db = require('./config/db');
const app = express();
const port = 3000;
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');

const isLoggedIn = (req, res, next) => {
    if (!req.session.user) {
        req.flash('error', 'Az oldal megtekintéséhez bejelentkezés szükséges!');
        return res.redirect('/bejelentkezes');
    }
    next(); // Ha be van jelentkezve, továbbengedjük
};

const isAdmin = (req, res, next) => {
    // Először ellenőrizzük, be van-e lépve
    if (!req.session.user) {
        req.flash('error', 'Az oldal megtekintéséhez bejelentkezés szükséges!');
        return res.redirect('/bejelentkezes');
    }
    // Utána ellenőrizzük, admin-e
    if (req.session.user.szerepkor !== 'admin') {
        req.flash('error', 'Nincs jogosultságod az oldal megtekintéséhez!');
        return res.redirect('/');
    }
    next(); // Ha be van lépve ÉS admin, továbbengedjük
};


app.set('view engine','ejs');
app.set('views',path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({extended: true}));

app.use(session({
    secret: 'asd123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }
}));

app.use(flash());

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash();
    next();
});

app.get('/', (req,res) =>{
    res.render('pages/index', {
        title: "Főoldal"
    });
});

app.get('/uzenetek', isLoggedIn, async (req, res) => {
    try {
        // A bejelentkezett felhasználó adatai a session-ből
        const user = req.session.user; 
        
        let sqlQuery = "";
        let params = []; // A lekérdezés paraméterei

        if (user.szerepkor === 'admin') {
            // 1. ADMIN ESETE: 
            // Admin lát minden üzenetet, kivéve a más adminok által küldötteket.
            // Ezért LEFT JOIN-t használunk a 'felhasznalok' táblával az email cím alapján.
            // Ahol a felhasználó 'regisztralt' VAGY 'IS NULL' (azaz látogató küldte),
            // azokat jelenítjük meg.
            sqlQuery = `
                SELECT u.* FROM uzenetek u
                LEFT JOIN felhasznalok f ON u.email = f.email
                WHERE f.szerepkor IS NULL OR f.szerepkor != 'admin'
                ORDER BY u.datum DESC
            `;
            // Nincs szükség paraméterre
            
        } else {
            // 2. SIMA FELHASZNÁLÓ ESETE:
            // Csak a saját, email címe alapján elküldött üzeneteit látja.
            sqlQuery = "SELECT * FROM uzenetek WHERE email = ? ORDER BY datum DESC";
            params.push(user.email); // Paraméter: a felhasználó saját email címe
        }

        // 3. Lekérdezés futtatása
        const [rows] = await db.query(sqlQuery, params);

        res.render('pages/uzenetek', {
            title: 'Beérkezett üzenetek',
            uzenetek: rows
        });

    } catch (error) {
        console.error('Hiba az üzenetek lekérdezése során:', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/');
    }
});

app.get('/admin/varosok', isAdmin, async (req, res) => {
    try {
        // 1. MINDIG a teljes listát kérjük le
        const [varosNevek] = await db.query("SELECT DISTINCT nev FROM varos ORDER BY nev");
        const [megyeNevek] = await db.query("SELECT DISTINCT nev FROM megye ORDER BY nev");

        const { varos, megye } = req.query;

        let sqlQuery = `
            SELECT v.id, v.nev AS varosNev, m.nev AS megyeNev, v.megyeszekhely, v.megyeijogu 
            FROM varos v 
            LEFT JOIN megye m ON v.megyeid = m.id 
        `;

        const whereClauses = [];
        const params = [];
        if (varos && varos !== "") {
            whereClauses.push("v.nev = ?");
            params.push(varos);
        }
        if (megye && megye !== "") {
            whereClauses.push("m.nev = ?");
            params.push(megye);
        }
        if (whereClauses.length > 0) {
            sqlQuery += " WHERE " + whereClauses.join(" AND ");
        }
        sqlQuery += " ORDER BY v.nev";

        const [rows] = await db.query(sqlQuery, params);

        res.render('pages/admin/varos-lista', {
            title: 'Admin - Városok',
            varosok: rows,
            szures: req.query,
            varosNevek: varosNevek, // TELJES lista
            megyeNevek: megyeNevek  // TELJES lista
        });

    } catch (error) {
        console.error('Hiba (Admin város lista):', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/');
    }
});

app.get('/admin/varos/uj', isAdmin, async (req, res) => {
    try {
        // Be kell töltenünk a megyéket a dropdown menühöz
        const [megyek] = await db.query("SELECT * FROM megye ORDER BY nev");

        res.render('pages/admin/varos-uj', {
            title: 'Új város',
            megyek: megyek
        });
    } catch (error) {
        console.error('Hiba (Új város GET):', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/admin/varosok');
    }
});

app.post('/admin/varos/uj', isAdmin, async (req, res) => {
    try {
        const { nev, megyeid, megyeszekhely, megyeijogu } = req.body;

        const isMegyeszekhely = megyeszekhely === '1' ? 1 : 0;
        const isMegyeijogu = megyeijogu === '1' ? 1 : 0;

        const sqlQuery = `
            INSERT INTO varos (nev, megyeid, megyeszekhely, megyeijogu) 
            VALUES (?, ?, ?, ?)
        `;
        await db.query(sqlQuery, [nev, megyeid, isMegyeszekhely, isMegyeijogu]);

        req.flash('success', 'A(z) ' + nev + ' nevű város sikeresen létrehozva.');
        res.redirect('/admin/varosok');

    } catch (error) {
        console.error('Hiba (Új város POST):', error);
        req.flash('error', 'Hiba történt a város létrehozása közben.');
        res.redirect('/admin/varosok');
    }
});

app.get('/admin/varos/torles/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. LÉPÉS: Törlés a 'lelekszam' táblából (függőségek)
        await db.query("DELETE FROM lelekszam WHERE varosid = ?", [id]);

        // 2. LÉPÉS: Törlés a 'varos' táblából
        await db.query("DELETE FROM varos WHERE id = ?", [id]);

        req.flash('success', 'A város és a hozzá tartozó lélekszám adatok sikeresen törölve.');
        res.redirect('/admin/varosok');

    } catch (error) {
        console.error('Hiba (Törlés GET):', error);
        req.flash('error', 'Hiba történt a város törlése közben.');
        res.redirect('/admin/varosok');
    }
});

app.get('/admin/varos/szerkeszt/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params; // A város ID-je az URL-ből

        // 1. Kell a megye lista (a város űrlaphoz)
        const [megyek] = await db.query("SELECT * FROM megye ORDER BY nev");
        
        // 2. Kell a szerkesztendő város adata
        const [varosok] = await db.query("SELECT * FROM varos WHERE id = ?", [id]);

        if (varosok.length === 0) {
            req.flash('error', 'A város nem található.');
            return res.redirect('/admin/varosok');
        }

        // 3. ÚJ: Lekérdezzük a városhoz tartozó ÖSSZES népességi adatot
        const [lelekszamAdatok] = await db.query(
            "SELECT * FROM lelekszam WHERE varosid = ? ORDER BY ev DESC", 
            [id]
        );

        res.render('pages/admin/varos-szerkeszt', {
            title: `Szerkesztés: ${varosok[0].nev}`,
            megyek: megyek,
            varos: varosok[0], // Átadjuk a város adatait
            lelekszamok: lelekszamAdatok // ÚJ: Átadjuk a népességi adatokat
        });
    } catch (error) {
        console.error('Hiba (Szerkesztés GET):', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/admin/varosok');
    }
});

app.post('/admin/varos/szerkeszt/:id', isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { nev, megyeid, megyeszekhely, megyeijogu } = req.body;

        const isMegyeszekhely = megyeszekhely === '1' ? 1 : 0;
        const isMegyeijogu = megyeijogu === '1' ? 1 : 0;

        const sqlQuery = `
            UPDATE varos 
            SET nev = ?, megyeid = ?, megyeszekhely = ?, megyeijogu = ?
            WHERE id = ?
        `;
        await db.query(sqlQuery, [nev, megyeid, isMegyeszekhely, isMegyeijogu, id]);

        req.flash('success', 'A(z) ' + nev + ' nevű város sikeresen módosítva.');
        res.redirect('/admin/varosok');

    } catch (error) {
        console.error('Hiba (Szerkesztés POST):', error);
        req.flash('error', 'Hiba történt a város módosítása közben.');
        res.redirect('/admin/varosok');
    }
});

app.get('/regisztracio', (req, res) => {
    res.render('pages/regisztracio', {
        title: 'Regisztráció'
    });
});

app.post('/regisztracio', async (req, res) => {
    const { nev, email, jelszo, jelszo_megerosit } = req.body;

    // 1. Validálás
    if (jelszo !== jelszo_megerosit) {
        req.flash('error', 'A két jelszó nem egyezik!');
        return res.redirect('/regisztracio');
    }

    try {
        // 2. Létezik-e már a felhasználó?
        const [letezoUser] = await db.query("SELECT * FROM felhasznalok WHERE email = ?", [email]);
        if (letezoUser.length > 0) {
            req.flash('error', 'Ez az email cím már foglalt!');
            return res.redirect('/regisztracio');
        }

        // 3. Jelszó hashelése
        const hashJelszo = await bcrypt.hash(jelszo, 10); // 10 a "salt" erőssége

        // 4. Felhasználó mentése az adatbázisba
        const sqlQuery = "INSERT INTO felhasznalok (nev, email, jelszo, szerepkor) VALUES (?, ?, ?, ?)";
        // Alapértelmezett szerepkör: 'regisztralt'
        await db.query(sqlQuery, [nev, email, hashJelszo, 'regisztralt']);

        // 5. Sikeres regisztráció
        req.flash('success', 'Sikeres regisztráció! Most már bejelentkezhetsz.');
        res.redirect('/bejelentkezes');

    } catch (error) {
        console.error('Hiba a regisztráció során:', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/regisztracio');
    }
});

app.get('/bejelentkezes', (req, res) => {
    res.render('pages/bejelentkezes', {
        title: 'Bejelentkezés'
    });
});

app.post('/bejelentkezes', async (req, res) => {
    const { email, jelszo } = req.body;

    try {
        // 1. Felhasználó keresése email alapján
        const [users] = await db.query("SELECT * FROM felhasznalok WHERE email = ?", [email]);

        if (users.length === 0) {
            req.flash('error', 'Hibás email cím vagy jelszó!');
            return res.redirect('/bejelentkezes');
        }

        const user = users[0];

        // 2. Jelszó összehasonlítása
        const jelszoEgyezik = await bcrypt.compare(jelszo, user.jelszo);

        if (!jelszoEgyezik) {
            req.flash('error', 'Hibás email cím vagy jelszó!');
            return res.redirect('/bejelentkezes');
        }

        // 3. Sikeres bejelentkezés -> Session beállítása
        // Ezzel "bejelentkeztetjük" a felhasználót
        req.session.user = {
            id: user.id,
            nev: user.nev,
            email: user.email,
            szerepkor: user.szerepkor
        };

        // 4. Átirányítás a főoldalra
        res.redirect('/');

    } catch (error) {
        console.error('Hiba a bejelentkezés során:', error);
        req.flash('error', 'Hiba történt a szerveren.');
        res.redirect('/bejelentkezes');
    }
});

app.get('/kijelentkezes', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/');
        }
        res.clearCookie('connect.sid'); // Törli a session sütit
        res.redirect('/');
    });
});

app.get('/kapcsolat', (req, res) => {
    res.render('pages/kapcsolat', {
        title: 'Kapcsolat'
    });
});

app.post('/kapcsolat', async (req, res) => {
    const { nev, email, uzenet } = req.body;

    try {
        const sqlQuery = "INSERT INTO uzenetek (nev, email, uzenet) VALUES (?, ?, ?)";
        await db.query(sqlQuery, [nev, email, uzenet]);

        res.redirect('/');

    } catch (error) {
        console.error('Hiba az üzenet mentése során:', error);
        res.status(500).send('Hiba történt a szerveren.');
    }
});

app.get('/adatbazis-lista', async (req, res) => {
    try {
        // 1. Listák lekérdezése a legördülő menükhöz
        const [varosNevek] = await db.query("SELECT DISTINCT nev FROM varos ORDER BY nev");
        const [megyeNevek] = await db.query("SELECT DISTINCT nev FROM megye ORDER BY nev");

        // 2. Szűrő paraméterek beolvasása (pl. ?megye=Békés)
        const { varos, megye } = req.query;

        // 3. Alap SQL lekérdezés
        // FONTOS: JOIN -> LEFT JOIN a 'lelekszam' táblánál!
        // Ez biztosítja, hogy azok a városok is megjelenjenek,
        // amelyekhez nincs népességi adat rendelve.
        let sqlQuery = `
            SELECT 
                v.nev AS varosNev,
                m.nev AS megyeNev,
                l.ev,
                l.no,
                l.osszesen
            FROM varos v
            JOIN megye m ON v.megyeid = m.id
            LEFT JOIN lelekszam l ON v.id = l.varosid 
        `; // <-- ITT A LÉNYEG!
        
        // 4. WHERE feltételek dinamikus hozzáadása
        const whereClauses = [];
        const params = [];

        // Csak akkor szűrünk, ha a paraméter létezik ÉS nem üres ("")
        if (varos && varos !== "") {
            whereClauses.push("v.nev = ?");
            params.push(varos);
        }
        if (megye && megye !== "") {
            whereClauses.push("m.nev = ?");
            params.push(megye);
        }

        // Ha van szűrés, hozzáadjuk a WHERE részt
        if (whereClauses.length > 0) {
            sqlQuery += " WHERE " + whereClauses.join(" AND ");
        }

        // 5. Rendezés
        sqlQuery += " ORDER BY v.nev, l.ev DESC";
        
        // 6. Lekérdezés futtatása
        const [rows] = await db.query(sqlQuery, params);

        // 7. Oldal renderelése a kapott adatokkal
        res.render('pages/adatbazis-lista', {
            title: 'Városlista',
            varosAdatok: rows,       // A táblázat adatai
            szures: req.query,       // A kiválasztott szűrők (hogy emlékezzen)
            varosNevek: varosNevek,  // A város legördülő lista tartalma
            megyeNevek: megyeNevek   // A megye legördülő lista tartalma
        });

    } catch (error) {
        // Hiba esetén ne omoljon össze, csak írja ki
        console.error('Hiba a /adatbazis-lista lekérdezés során:', error);
        res.status(500).send('Hiba történt a szerveren az adatok lekérése közben.');
    }
});

app.get('/api/varosok-by-megye', async (req, res) => {
    try {
        const { megye } = req.query;
        let sqlQuery = "";
        let params = [];

        if (megye && megye !== "") {
            sqlQuery = `SELECT v.nev FROM varos v
                        JOIN megye m ON v.megyeid = m.id
                        WHERE m.nev = ? ORDER BY v.nev`;
            params.push(megye);
        } else {
            // Ha nincs megye ("-- Összes --"), adjuk vissza az összes várost
            sqlQuery = "SELECT DISTINCT nev FROM varos ORDER BY nev";
        }
        
        const [varosok] = await db.query(sqlQuery, params);
        res.json(varosok); // Visszaadjuk az eredményt JSON-ként
    } catch (error) {
        console.error('API hiba (varosok-by-megye):', error);
        res.status(500).json({ error: 'Szerverhiba' });
    }
});

// 2. API: Megye lekérdezése városnév alapján
app.get('/api/megye-by-varos', async (req, res) => {
    try {
        const { varos } = req.query;
        if (!varos || varos === "") {
            return res.json({ megyeNev: "" });
        }
        
        const sqlQuery = `SELECT m.nev AS megyeNev FROM megye m
                          JOIN varos v ON v.megyeid = m.id
                          WHERE v.nev = ?`;
        const [rows] = await db.query(sqlQuery, [varos]);
        
        if (rows.length > 0) {
            res.json({ megyeNev: rows[0].megyeNev });
        } else {
            res.json({ megyeNev: "" });
        }
    } catch (error) {
        console.error('API hiba (megye-by-varos):', error);
        res.status(500).json({ error: 'Szerverhiba' });
    }
});

app.post('/admin/lelekszam/uj', isAdmin, async (req, res) => {
    // A rejtett mezőből kapjuk a varosid-t
    const { varosid, ev, osszesen, no } = req.body;
    try {
        const sqlQuery = "INSERT INTO lelekszam (varosid, ev, no, osszesen) VALUES (?, ?, ?, ?)";
        await db.query(sqlQuery, [varosid, ev, no, osszesen]);
        
        req.flash('success', `${ev} évi népességi adat sikeresen hozzáadva.`);
    } catch (error) {
        console.error('Hiba (Új lélekszám POST):', error);
        // Kezeljük, ha a kulcs (varosid, ev) már létezik
        if (error.code === 'ER_DUP_ENTRY') {
            req.flash('error', `A(z) ${ev} évhez már létezik adat ennél a városnál. Használd a szerkesztést.`);
        } else {
            req.flash('error', 'Hiba történt az adat mentése közben.');
        }
    }
    // Visszairányítjuk az eredeti szerkesztő oldalra
    res.redirect(`/admin/varos/szerkeszt/${varosid}`);
});

app.get('/admin/lelekszam/torles/:varosid/:ev', isAdmin, async (req, res) => {
    const { varosid, ev } = req.params;
    try {
        await db.query("DELETE FROM lelekszam WHERE varosid = ? AND ev = ?", [varosid, ev]);
        req.flash('success', `${ev} évi adat sikeresen törölve.`);
    } catch (error) {
        console.error('Hiba (Lélekszám törlés):', error);
        req.flash('error', 'Hiba történt az adat törlése közben.');
    }
    // Visszairányítás a fő szerkesztő oldalra
    res.redirect(`/admin/varos/szerkeszt/${varosid}`);
});

app.get('/admin/lelekszam/szerkeszt/:varosid/:ev', isAdmin, async (req, res) => {
    try {
        const { varosid, ev } = req.params;

        // Lekérdezzük a lélekszám adatot, ÉS a város nevét a szebb megjelenítéshez
        const sqlQuery = `
            SELECT l.*, v.nev AS varosNev 
            FROM lelekszam l
            JOIN varos v ON l.varosid = v.id
            WHERE l.varosid = ? AND l.ev = ?
        `;
        const [rows] = await db.query(sqlQuery, [varosid, ev]);

        if (rows.length === 0) {
            req.flash('error', 'A keresett népességi adat nem található.');
            return res.redirect(`/admin/varos/szerkeszt/${varosid}`);
        }

        res.render('pages/admin/lelekszam-szerkeszt', {
            title: 'Népesség szerkesztése',
            adat: rows[0] // Átadjuk az 1 db rekordot
        });
        
    } catch (error) {
        console.error('Hiba (Lélekszám szerkesztés GET):', error);
        req.flash('error', 'Szerverhiba történt.');
        res.redirect(`/admin/varos/szerkeszt/${varosid}`);
    }
});

app.post('/admin/lelekszam/szerkeszt/:varosid/:ev', isAdmin, async (req, res) => {
    const { varosid, ev } = req.params;
    const { osszesen, no } = req.body; // Az űrlapból jövő új adatok

    try {
        const sqlQuery = "UPDATE lelekszam SET osszesen = ?, no = ? WHERE varosid = ? AND ev = ?";
        await db.query(sqlQuery, [osszesen, no, varosid, ev]);
        
        req.flash('success', `${ev} évi adat sikeresen módosítva.`);
    } catch (error) {
        console.error('Hiba (Lélekszám szerkesztés POST):', error);
        req.flash('error', 'Hiba történt az adat módosítása közben.');
    }
    // Visszairányítjuk a fő szerkesztő oldalra
    res.redirect(`/admin/varos/szerkeszt/${varosid}`);
});


app.listen(port, () =>{
    console.log(`Szerver elinditva http://localhost:${port} cimen.`);
});

