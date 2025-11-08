const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

app.set('view engine','ejs');
app.set('views',path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({extended: true}));

app.get('/', (req,res) =>{
    res.render('pages/index', {
        title: "Főoldal"
    });
});

app.listen(port, () =>{
    console.log(`Szerver elinditva http://localhost:${port} cimen.`);
});