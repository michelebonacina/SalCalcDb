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

// 
// ## mongodb connection ##
//

// detect environment and connect to appropriate DB
if (appEnv.isLocal)
{
    mongoose.connect(process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB);
    sessionDB = process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB;
    console.log('Your MongoDB is running at ' + process.env.LOCAL_MONGODB_URL + "/" + process.env.LOCAL_MONGODB_DB);
}
// connect to MongoDB Service on Bluemix
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

// 
// ## middleware & settings ##
// 

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

// 
// ## manager api calls
//

// get home
// trap request to / (homepage) and return index file
app.get('/',
    (request, response) =>
    {
        response.sendfile('index.html');
    }
);

// list all persons
// trap request to person list, load from persistence and return
app.get('/api/person/list',
    (request, response) =>
    {
        // prepare and execute query
        var query = Person.find().sort({ surname: 1, name: 1 });
        query.exec(
            (error, persons) =>
            {
                // finded persons
                var personList = [];
                for (var i in persons)
                {
                    // add person to list
                    personList.push(
                        {
                            id: persons[i]._id,
                            surname: persons[i].surname,
                            name: persons[i].name,
                            birthdate: persons[i].birthdate ? dateFormat(persons[i].birthdate, 'yyyy-mm-dd') : null,
                        }
                    );
                }
                // send finded persons to response
                response.send(JSON.stringify(personList));
            }
        );
    }
);

// create a new person
// trap request to create person, get data and store in persistence 
app.post('/api/person/create',
    (request, response) =>
    {
        // check if person data are posted
        request.checkBody('surname', 'Surname is required').notEmpty();
        request.checkBody('name', 'Name is required').notEmpty();
        // check errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // send error response
            response.status(400).send(errors);
            return;
        }
        // create a new person
        var person = new Person(
            {
                surname: request.body.surname,
                name: request.body.name,
                birthdate: request.body.birthdate,
            }
        )
        // store person in persistence
        person.save(
            // manage store result
            (error) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error saving new person (database error). Please try again.');
                    return;
                }
                // send ok response
                response.status(200).send('Person created!');
            }
        );
    }
);

// update an existing person
// trap update person request, get data and update in persistence
app.post('/api/person/update/*',
    (request, response) =>
    {
        // get person's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // check if person's mandatory data are posted
        request.checkBody('surname', 'Surname is required').notEmpty();
        request.checkBody('name', 'Name is required').notEmpty();
        // check errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // send error response
            response.status(400).send(errors);
            return;
        }
        // load person
        Person.findById(id,
            (error, person) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing person (database error). Please try again.');
                    return;
                }
                // update person's data
                person.surname = request.body.surname;
                person.name = request.body.name;
                person.birthdate = request.body.birthdate;
                // store person in persistence
                person.save(
                    // manage store result
                    (error) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send('Error updating existing person (database error). Please try again.');
                            return;
                        }
                        // send ok response
                        response.status(200).send('Person updated!');
                    }
                );
            }
        )
    }
);

// delete an existing person
// trap delete person request and remove from persistence
app.delete('/api/person/delete/*',
    (request, response) =>
    {
        // get person's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // load person
        Person.findById(id,
            (error, person) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing person (database error). Please try again.');
                    return;
                }
                // delete person from persistence
                person.remove(
                    (error, person) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send('Error deleting existing person (database error). Please try again.');
                            return;
                        }
                        // send ok response
                        response.status(200).send('Person deleted!');
                    }
                );
            }
        );
    }
);

// check user login
// trap login request, get use credentials and check in persistence
app.post('/api/user/login',
    (request, response) =>
    {
        // check login data
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
        // search user
        User.findOne(
            { username: request.body.username },
            (error, user) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                if (user)
                {
                    // user finded
                    // check password
                    if (bcrypt.compareSync(request.body.password, user.password))
                    {
                        // password match
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
                        // wrong password
                        // send ko response
                        response.status(401).send('User unauthorized');
                    }
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
// trap user list request, get from persistence and return
app.get('/api/user/list',
    (request, response) =>
    {
        // prepare and execute query
        var query = User.find().sort({ username: 1 });
        query.exec(
            (error, users) =>
            {
                // finded users
                var userList = [];
                for (var i in users)
                {
                    // add user to list
                    userList.push(
                        {
                            id: users[i]._id,
                            username: users[i].username,
                        }
                    );
                }
                // send finded users to response
                response.send(JSON.stringify(userList));
            }
        );
    }
);

// initialize the first user
// trap initilized user request, get data and store in persistence
app.get('/api/user/initialize',
    (request, response) =>
    {
        // check user list
        var query = User.count();
        query.exec(
            (error, count) =>
            {
                if (count == 0)
                {
                    // no user defined
                    // split url parts
                    var urlParts = url.parse(request.url, true);
                    var urlQuery = urlParts.query;
                    if (urlQuery.username && urlQuery.password)
                    {
                        // encrypt password
                        var salt = bcrypt.genSaltSync(10);
                        var hash = bcrypt.hashSync(urlQuery.password, salt);
                        // create a new user
                        var user = new User(
                            {
                                username: urlQuery.username,
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
                    else
                    {
                        // mandatory data missing
                        response.status(400).send('Username and Password are mandatory!');
                    }
                }
                else
                {
                    // there're other users
                    response.status(400).send('Initialization available only with no user defined!');
                }

            }
        );

    }
);


// create a new user
// trap create user request, get data and store in persistence
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

// update an existing user
// trap user update request, get data and update in persistence
app.post('/api/user/update/*',
    (request, response) =>
    {
        // get user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // check if user's mandatory data are posted
        request.checkBody('username', 'Username is required').notEmpty();
        // check errors and return an array with validation errors
        var errors = request.validationErrors();
        if (errors)
        {
            // send error response
            response.status(400).send(errors);
            return;
        }
        // load user
        User.findById(id,
            (error, user) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // update user's data
                user.username = request.body.username;
                // store user in persistence
                user.save(
                    // manage store result
                    (error) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send('Error updating existing user (database error). Please try again.');
                            return;
                        }
                        // send ok response
                        response.status(200).send('User updated!');
                    }
                );
            }
        )
    }
);

// change existing user password
// trap change password request, get data and update in persistence
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
            // send error response
            response.status(400).send(errors);
            return;
        }
        // load user
        User.findById(id,
            (error, user) =>
            {
                // manages find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // encrypt password
                var salt = bcrypt.genSaltSync(10);
                var hash = bcrypt.hashSync(request.body.password, salt);
                // update user's data
                user.password = hash;
                // store user in persistence
                user.save(
                    // manage store result
                    (error) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send('Error changingc existing user password (database error). Please try again.');
                            return;
                        }
                        // send ok response
                        response.status(200).send('Password changed!');
                    }
                );
            }
        )
    }
);

// delete an existing user
// trap delete user request and remove from persistence
app.delete('/api/user/delete/*',
    (request, response) =>
    {
        // get user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // load user
        User.findById(id,
            (error, user) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send('Error finding existing user (database error). Please try again.');
                    return;
                }
                // delete user from persistence
                user.remove(
                    (error, user) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send('Error deleting existing user (database error). Please try again.');
                            return;
                        }
                        // send ok response
                        response.status(200).send('User deleted!');
                    }
                );
            }
        );
    }
);

//
// ## server startup ##
//

// start server
app.listen(appEnv.port, appEnv.bind,
    function ()
    {
        console.log("Node server running on " + appEnv.url);
    }
);