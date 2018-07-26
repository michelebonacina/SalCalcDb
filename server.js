'use strict';

var express = require('express'),                       // server middleware
    mongoose = require('mongoose'),                     // MongoDB connection library
    bodyParser = require('body-parser'),                // parse HTTP requests
    url = require('url'),
    expressValidator = require('express-validator'),    // validation tool for processing user input
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    cors = require('cors'),
    MongoStore = require('connect-mongo/es5')(session), // store sessions in MongoDB for persistence
    bcrypt = require('bcrypt'),                         // middleware to encrypt/decrypt passwords
    sessionDB,

    cfenv = require('cfenv'),                           // Cloud Foundry Environment Variables
    appEnv = cfenv.getAppEnv(),                         // Grab environment variables
    dateFormat = require('dateformat'),

    Person = require('./server/models/person.model'),
    User = require('./server/models/user.model');


if (appEnv.isLocal)
{
    require('dotenv').load();   // Loads .env file into environment
}

// //////////////////
// MONGODB CONNECTION

//Detects environment and connects to appropriate DB
if (appEnv.isLocal)
{
    mongoose.connect(process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB);
    sessionDB = process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB;
    console.log('Your MongoDB is running at ' + process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB);
}
// Connect to MongoDB Service on Bluemix
else if (!appEnv.isLocal)
{
    var mongoDbUrl, mongoDbOptions = {};
    var mongoDbCredentials = appEnv.services["compose-for-mongodb"][0].credentials;
    var ca = [new Buffer(mongoDbCredentials.ca_certificate_base64, 'base64')];
    mongoDbUrl = mongoDbCredentials.uri;
    mongoDbOptions = {
        mongos: {
            ssl: true,
            sslValidate: true,
            sslCA: ca,
            poolSize: 1,
            reconnectTries: 1
        }
    };

    console.log("Your MongoDB is running at ", mongoDbUrl);
    mongoose.connect(mongoDbUrl, mongoDbOptions); // connect to our database
    sessionDB = mongoDbUrl;
}
else
{
    console.log('Unable to connect to MongoDB.');
}

// /////////////////////
// MIDDLEWARE & SETTINGS

var app = express();
app.enable('trust proxy');
// Use SSL connection provided by Bluemix. No setup required besides redirecting all HTTP requests to HTTPS
if (!appEnv.isLocal)
{
    app.use(function (req, res, next)
    {
        if (req.secure) // returns true is protocol = https
            next();
        else
            res.redirect('https://' + req.headers.host + req.url);
    });
}
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressValidator()); // must go directly after bodyParser
app.use(cookieParser());
app.use(session(
    {
        secret: process.env.SESSION_SECRET || 'this_is_a_default_session_secret_in_case_one_is_not_defined',
        resave: true,
        store: new MongoStore(
            {
                url: sessionDB,
                autoReconnect: true
            }
        ),
        saveUninitialized: false,
        cookie: { secure: true }
    }
));
app.use(cors(
    {
        origin: 'http://localhost:4200',
        credentials: true
    }
));

// ////////////////
// MANAGE API CALLS

// gets home
app.get('/',
    (request, response) =>
    {
        response.sendfile('index.html');
    }
);

// lists all persons
app.get('/api/person/list',
    (request, response) =>
    {
        // prepares and execute query
        var query = Person.find().sort({ surname: 1, name: 1 });
        query.exec(
            (error, persons) =>
            {
                // finded persons
                var personList = [];
                for (var i in persons)
                {
                    // adds person to list
                    personList.push(
                        {
                            id: persons[i]._id,
                            surname: persons[i].surname,
                            name: persons[i].name,
                            birthdate: dateFormat(persons[i].birthdate, 'yyyy-mm-dd'),
                        }
                    );
                }
                // sends finded persons to response
                response.send(JSON.stringify(personList));
            }
        );
    }
);

// creates a new person
app.post('/api/person/create',
    (request, response) =>
    {
        // checks if person's data are posted
        request.checkBody('surname', 'Surname is required').notEmpty();
        request.checkBody('name', 'Name is required').notEmpty();
        // checks errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // sends error response
            response.status(400).send(errors);
            return;
        }
        // creates a new person
        var person = new Person(
            {
                surname: request.body.surname,
                name: request.body.name,
                birthdate: request.body.birthdate,
            }
        )
        // stores person in persistence
        person.save(
            // manages store result
            (error) =>
            {
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error saving new person (database error). Please try again.');
                    return;
                }
                // sends ok response
                response.status(200).send('Person created!');
            }
        );
    }
);

// updates an existing person
app.post('/api/person/update/*',
    (request, response) =>
    {
        // gets person's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // checks if person's mandatory data are posted
        request.checkBody('surname', 'Surname is required').notEmpty();
        request.checkBody('name', 'Name is required').notEmpty();
        // checks errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // sends error response
            response.status(400).send(errors);
            return;
        }
        // loads person
        Person.findById(id,
            (error, person) =>
            {
                // manages find result
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing person (database error). Please try again.');
                    return;
                }
                // updates person's data
                person.surname = request.body.surname;
                person.name = request.body.name;
                person.birthdate = request.body.birthdate;
                // stores person in persistence
                person.save(
                    // manages store result
                    (error) =>
                    {
                        if (error)
                        {
                            // sends error response
                            console.log(error);
                            response.status(500).send('Error updating existing person (database error). Please try again.');
                            return;
                        }
                        // sends ok response
                        response.status(200).send('Person updated!');
                    }
                );
            }
        )
    }
);

// deletes an existing person
app.delete('/api/person/delete/*',
    (request, response) =>
    {
        // gets person's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // loads person
        Person.findById(id,
            (error, person) =>
            {
                // manages find result
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing person (database error). Please try again.');
                    return;
                }
                // deletes person from persistence
                person.remove(
                    (error, person) =>
                    {
                        if (error)
                        {
                            // sends error response
                            console.log(error);
                            response.status(500).send('Error deleting existing person (database error). Please try again.');
                            return;
                        }
                        // sends ok response
                        response.status(200).send('Person deleted!');
                    }
                );
            }
        );
    }
);

// check user login
app.post('/api/user/login',
    (request, response) =>
    {
        // check login data
        request.checkBody('username', 'Username is required').notEmpty();
        request.checkBody('password', 'Password is required').notEmpty();
        // checks errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // sends error response
            response.status(400).send(errors);
            return;
        }
        // encrypt password
        var salt = bcrypt.genSaltSync(10);
        var hash = bcrypt.hashSync(request.body.password, salt);
        // get username and pawword
        User.findOne(
            { username: request.body.username, password: hash },
            (error, user) =>
            {
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                if (user)
                {
                    // user finded
                    var authenticatedUser =
                    {
                        id: user._id,
                        username: user.username,
                    };
                    // send ok response
                    response.status(200).send(JSON.stringify(authenticatedUser));
                }
                else 
                {
                    // user not exist
                    // send ko response
                    response.status(401).send('User unauthorized');
                }
            }
        );
    }
);

// list all users
app.get('/api/user/list',
    (request, response) =>
    {
        // prepares and execute query
        var query = User.find().sort({ username: 1 });
        query.exec(
            (error, users) =>
            {
                // finded users
                var userList = [];
                for (var i in users)
                {
                    // adds user to list
                    userList.push(
                        {
                            id: users[i]._id,
                            username: users[i].username,
                        }
                    );
                }
                // sends finded users to response
                response.send(JSON.stringify(userList));
            }
        );
    }
);

// create a new user
app.post('/api/user/create',
    (request, response) =>
    {
        // check if user data are posted
        request.checkBody('username', 'Username is required').notEmpty();
        request.checkBody('password', 'Password is required').notEmpty();
        // check errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // send error response
            response.status(400).send(errors);
            return;
        }
        // encrypt password
        var salt = bcrypt.genSaltSync(10);
        var hash = bcrypt.hashSync(request.body.password, salt);
        // create a new user
        var user = new User(
            {
                username: request.body.username,
                password: hash,
            }
        )
        // store user in persistence
        user.save(
            // manage store result
            (error) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error saving new user (database error). Please try again.');
                    return;
                }
                // sends ok response
                response.status(200).send('User created!');
            }
        );
    }
);

// updates an existing user
app.post('/api/user/update/*',
    (request, response) =>
    {
        // gets user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // checks if user's mandatory data are posted
        request.checkBody('username', 'Username is required').notEmpty();
        // checks errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // sends error response
            response.status(400).send(errors);
            return;
        }
        // loads user
        User.findById(id,
            (error, user) =>
            {
                // manages find result
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // updates user's data
                user.username = request.body.username;
                // stores user in persistence
                user.save(
                    // manages store result
                    (error) =>
                    {
                        if (error)
                        {
                            // sends error response
                            console.log(error);
                            response.status(500).send('Error updating existing user (database error). Please try again.');
                            return;
                        }
                        // sends ok response
                        response.status(200).send('User updated!');
                    }
                );
            }
        )
    }
);

// change existing user password
app.post('/api/user/changePassword/*',
    (request, response) =>
    {
        // get user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // check if user's mandatory data are posted
        request.checkBody('password', 'Password is required').notEmpty();
        // checks errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // sends error response
            response.status(400).send(errors);
            return;
        }
        // loads user
        User.findById(id,
            (error, user) =>
            {
                // manages find result
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // encrypt password
                var salt = bcrypt.genSaltSync(10);
                var hash = bcrypt.hashSync(request.body.password, salt);
                // updates user's data
                user.password = hash;
                // stores user in persistence
                user.save(
                    // manages store result
                    (error) =>
                    {
                        if (error)
                        {
                            // sends error response
                            console.log(error);
                            response.status(500).send('Error changingc existing user password (database error). Please try again.');
                            return;
                        }
                        // sends ok response
                        response.status(200).send('Password changed!');
                    }
                );
            }
        )
    }
);

// deletes an existing user
app.delete('/api/user/delete/*',
    (request, response) =>
    {
        // gets user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // loads user
        User.findById(id,
            (error, user) =>
            {
                // manages find result
                if (error)
                {
                    // sends error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // deletes user from persistence
                user.remove(
                    (error, user) =>
                    {
                        if (error)
                        {
                            // sends error response
                            console.log(error);
                            response.status(500).send('Error deleting existing user (database error). Please try again.');
                            return;
                        }
                        // sends ok response
                        response.status(200).send('User deleted!');
                    }
                );
            }
        );
    }
);

// //////////////
// SERVER STARTUP

app.listen(appEnv.port, appEnv.bind,
    function ()
    {
        console.log("Node server running on " + appEnv.url);
    }
);