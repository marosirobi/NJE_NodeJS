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
        // Lekérdezés fordított időrendben [cite: 29]
        const [rows] = await db.query("SELECT * FROM uzenetek ORDER BY datum DESC");

        res.render('pages/uzenetek', {
            title: 'Üzenetek',
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
        // JOIN-oljuk a megye nevét a jobb olvashatóságért
        const sqlQuery = `
            SELECT v.id, v.nev AS varosNev, m.nev AS megyeNev, v.megyeszekhely, v.megyeijogu 
            FROM varos v 
            LEFT JOIN megye m ON v.megyeid = m.id 
            ORDER BY v.nev
        `;
        const [rows] = await db.query(sqlQuery);

        res.render('pages/admin/varos-lista', {
            title: 'Admin - Városok',
            varosok: rows
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
        const { id } = req.params;

        const [megyek] = await db.query("SELECT * FROM megye ORDER BY nev");

        const [varosok] = await db.query("SELECT * FROM varos WHERE id = ?", [id]);

        if (varosok.length === 0) {
            req.flash('error', 'A város nem található.');
            return res.redirect('/admin/varosok');
        }

        res.render('pages/admin/varos-szerkeszt', {
            title: 'Város szerkesztése',
            megyek: megyek,
            varos: varosok[0]
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
        const sqlQuery = `
            SELECT 
                v.nev AS varosNev,
                m.nev AS megyeNev,
                l.ev,
                l.no,
                l.osszesen
            FROM varos v
            JOIN megye m ON v.megyeid = m.id
            JOIN lelekszam l ON v.id = l.varosid
            ORDER BY v.nev, l.ev DESC;
        `;

        const [rows] = await db.query(sqlQuery);

        res.render('pages/adatbazis-lista', {
            title: 'Városlista',
            varosAdatok: rows
        });

    } catch (error) {
        console.error('Hiba a lekérdezés során:', error);
        res.status(500).send('Hiba történt a szerveren.');
    }
});


app.listen(port, () =>{
    console.log(`Szerver elinditva http://localhost:${port} cimen.`);
});

