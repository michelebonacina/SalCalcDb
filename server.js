'use strict';

var express = require('express'),                       // server middleware
    basicAuth = require('express-basic-auth'),
    bodyParser = require('body-parser'),                // parse HTTP requests
    url = require('url'),
    expressValidator = require('express-validator'),    // validation tool for processing user input
    cookieParser = require('cookie-parser'),
    cors = require('cors'),
    bcrypt = require('bcrypt'),                         // middleware to encrypt/decrypt passwords
    cfenv = require('cfenv'),                           // Cloud Foundry Environment Variables
    appEnv = cfenv.getAppEnv(),                         // Grab environment variables
    dateFormat = require('dateformat'),
    cloudant = require('cloudant'),

    Person = require('./server/models/person.model'),
    User = require('./server/models/user.model');


if (appEnv.isLocal)
{
    require('dotenv').load();   // Loads .env file into environment
}

// 
// ## cloudantdb connection ##
//

// detect environment and connect to appropriate DB
var cloudant_url;
if (appEnv.isLocal)
{
    console.log("Local execution");
    cloudant_url = "https://052bea8a-ae3e-4a95-b26f-93e9c5fca4cc-bluemix:a01384e68b8a4d804d10e90c60f3f71a5200b3ee3fff27141328c3b126c00b79@052bea8a-ae3e-4a95-b26f-93e9c5fca4cc-bluemix.cloudant.com"
}
// connect to Cloudant DB on Bluemix
else if (!appEnv.isLocal)
{
    console.log("Cloud execution");
    var services = JSON.parse(process.env.VCAP_SERVICES || "{}");
    if (process.env.VCAP_SERVICES)
    {
        services = JSON.parse(process.env.VCAP_SERVICES);
        if (services.cloudantNoSQLDB) //Check if cloudantNoSQLDB service is bound to your project
        {
            cloudant_url = services.cloudantNoSQLDB[0].credentials.url;  //Get URL and other paramters
            console.log("Name = " + services.cloudantNoSQLDB[0].name);
            console.log("URL = " + services.cloudantNoSQLDB[0].credentials.url);
            console.log("username = " + services.cloudantNoSQLDB[0].credentials.username);
            console.log("password = " + services.cloudantNoSQLDB[0].credentials.password);
        }
    }
}
else
{
    console.log('Unable to connect to Cloudant DB.');
}

//Connect using cloudant npm and URL obtained from previous step
var cloudantDb = cloudant({ url: cloudant_url });
//Edit this variable value to change name of database.
var dbname = 'salcalc';
var db;

//Create database
cloudantDb.db.create(dbname,
    (err, data) =>
    {
        if (err)
        {
            // database exists
            console.log("Database exists.");
            // open database
            db = cloudantDb.db.use(dbname);
        }
        else
        {
            // database not exists
            console.log("Database created.");
            // open database
            db = cloudantDb.db.use(dbname);
            // create indexes
            // docType index
            var index =
            {
                index: { fields: ["docType"] },
                name: "docType-index",
                type: "json",
            };
            db.index(index,
                (error, data) =>
                {
                    if (error)
                    {
                        // error creating index
                        console.log("Error creating docType-index.", error)
                    }
                    else 
                    {
                        // index created
                        console.log("Index docType-index create");
                    }
                }
            );
            // user 01 index
            index =
                {
                    index: { fields: ["docType", "username"] },
                    name: "user01-index",
                    type: "json",
                };
            db.index(index,
                (error, data) =>
                {
                    if (error)
                    {
                        // error creating index
                        console.log("Error creating user01-index.", error)
                    }
                    else 
                    {
                        // index created
                        console.log("Index user01-index create");
                    }
                }
            );
            // person index 01
            var index =
            {
                index: { fields: ["docType", "surname", "name"] },
                name: "person01-index",
                type: "json",
            };
            db.index(index,
                (error, data) =>
                {
                    if (error)
                    {
                        // error creating index
                        console.log("Error creating user01-index.", error)
                    }
                    else 
                    {
                        // index created
                        console.log("Index user01-index create");
                    }
                }
            );
        }
    }
);

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
app.use(cors(
    {
        origin: ['https://salcalc.eu-gb.mybluemix.net', 'http://localhost:4200'],
        credentials: true
    }
));

var auth = basicAuth(
    {
        authorizer:
            (username, password, callback) =>
            {
                // search user
                var query =
                {
                    selector:
                    {
                        docType: "user",
                        username: username,
                        password: password
                    }
                };
                var authorized = false;
                db.find(query,
                    (error, users) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            return callback(error, false);
                        }
                        if (users && users.docs && users.docs[0])
                        {
                            // user finded
                            return callback(null, true);
                        }
                        // user not finded
                        return callback(null, false);
                    }
                );
            },
        authorizeAsync: true,
        challenge: true,
        realm: 'Imb4T3st4pp',
    }
)

// 
// ## manager api calls
//

// get home
// trap request to / (homepage) and return index file
app.get('/',
    (request, response) =>
    {
        response.sendfile('index.html');
        return;
    }
);

// list all persons
// trap request to person list, load from persistence and return
app.get('/api/person/list', auth,
    (request, response) =>
    {
        // prepare and execute query
        var query =
        {
            selector: { docType: "person" },
            sort: [{ docType: "asc" }, { surname: "asc" }, { name: "asc" }]
        };
        db.find(query,
            (error, persons) =>
            {
                if (error)
                {
                    // error finding persons list
                    console.log(error);
                    response.status("500").send({ message: 'Error loading persons (database error). Please try again.' });
                    return;
                }
                // initialize persons list
                var personList = [];
                if (persons && persons.docs && persons.docs.length > 0)
                {
                    // finded persons
                    for (var i in persons.docs)
                    {
                        // add person to list
                        personList.push(
                            {
                                id: persons.docs[i]._id,
                                surname: persons.docs[i].surname,
                                name: persons.docs[i].name,
                                birthdate: persons.docs[i].birthdate ? dateFormat(persons.docs[i].birthdate, 'yyyy-mm-dd') : null,
                            }
                        );
                    }
                }
                // send finded persons to response
                response.status(200).send(JSON.stringify(personList));
                return;
            }
        );
    }
);

// create a new person
// trap request to create person, get data and store in persistence 
app.post('/api/person/create', auth,
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
        var person =
        {
            docType: "person",
            surname: request.body.surname,
            name: request.body.name,
            birthdate: request.body.birthdate,
        };
        // store person in persistence
        db.insert(person,
            // manage store result
            (error, data) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error saving new person (database error). Please try again.' });
                    return;
                }
                // send ok response
                response.status(200).send({ message: 'Person created!' });
                return;
            }
        );
    }
);

// update an existing person
// trap update person request, get data and update in persistence
app.post('/api/person/update/*', auth,
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
        db.get(id,
            (error, person) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding existing person (database error). Please try again.' });
                    return;
                }
                // update person's data
                person.surname = request.body.surname;
                person.name = request.body.name;
                person.birthdate = request.body.birthdate;
                // store person in persistence
                db.insert(person,
                    // manage store result
                    (error, data) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send({ message: 'Error updating existing person (database error). Please try again.' });
                            return;
                        }
                        // send ok response
                        response.status(200).send({ message: 'Person updated!' });
                        return;
                    }
                );
            }
        )
    }
);

// delete an existing person
// trap delete person request and remove from persistence
app.delete('/api/person/delete/*', auth,
    (request, response) =>
    {
        // get person's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // load person
        db.get(id,
            (error, person) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding existing person (database error). Please try again.' });
                    return;
                }
                // delete person from persistence
                db.destroy(person._id, person._rev,
                    (error, data) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send({ message: 'Error deleting existing person (database error). Please try again.' });
                            return;
                        }
                        // send ok response
                        response.status(200).send({ message: 'Person deleted!' });
                        return;
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
        var query =
        {
            selector:
            {
                docType: "user",
                username: request.body.username
            }
        };
        db.find(query,
            (error, users) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding existing user (database error). Please try again.' });
                    return;
                }
                if (users && users.docs && users.docs[0])
                {
                    // user finded
                    // check password
                    if (bcrypt.compareSync(request.body.password, users.docs[0].password))
                    {
                        // password match
                        var authenticatedUser =
                        {
                            id: users.docs[0]._id,
                            username: users.docs[0].username,
                            password: users.docs[0].password,
                        };
                        // send ok response
                        response.status(200).send(JSON.stringify(authenticatedUser));
                        return;
                    }
                    else 
                    {
                        // wrong password
                        // send ko response
                        response.status(401).send({ message: 'User unauthorized' });
                        return;
                    }
                }
                else 
                {
                    // user not exist
                    // send ko response
                    response.status(401).send({ message: 'User unauthorized' });
                    return;
                }
            }
        );
    }
);

// list all users
// trap user list request, get from persistence and return
app.get('/api/user/list', auth,
    (request, response) =>
    {
        // prepare and execute query
        var query =
        {
            selector: { docType: "user" },
            sort: [{ username: "asc" }]
        };
        db.find(query,
            (error, users) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding users list (database error). Please try again.' });
                    return;
                }
                // initialize users list
                var userList = [];
                if (users && users.docs)
                {
                    // finded users
                    for (var i in users.docs)
                    {
                        // add user to list
                        userList.push(
                            {
                                id: users.docs[i]._id,
                                username: users.docs[i].username,
                            }
                        );
                    }
                }
                // send finded users to response
                response.send(JSON.stringify(userList));
                return;
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
        var query =
        {
            selector: { docType: "user" }
        };
        db.find(query,
            (error, users) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding users list (database error). Please try again.' });
                    return;
                }
                if (users.docs.length == 0)
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
                        var user =
                        {
                            docType: "user",
                            username: urlQuery.username,
                            password: hash,
                        };
                        // store user in persistence
                        db.insert(user,
                            (error, data) =>
                            {
                                if (error)
                                {
                                    // send error response
                                    console.log(error);
                                    response.status(500).send({ message: 'Error saving new user (database error). Please try again.' });
                                    return;
                                }
                                // sends ok response
                                response.status(200).send({ message: 'User created!' });
                                return;
                            }
                        );

                    }
                    else
                    {
                        // mandatory data missing
                        response.status(400).send({ message: 'Username and Password are mandatory!' });
                        return;
                    }
                }
                else
                {
                    // there're other users
                    response.status(400).send({ message: 'Initialization available only with no user defined!' });
                    return;
                }
            }
        );

    }
);


// create a new user
// trap create user request, get data and store in persistence
app.post('/api/user/create', auth,
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
        var user =
        {
            docType: "user",
            username: request.body.username,
            password: hash,
        };
        // store user in persistence
        db.insert(user,
            // manage store result
            (error, data) =>
            {
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error saving new user (database error). Please try again.' });
                    return;
                }
                // sends ok response
                response.status(200).send({ message: 'User created!' });
                return;
            }
        );
    }
);

// update an existing user
// trap user update request, get data and update in persistence
app.post('/api/user/update/*', auth,
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
        db.get(id,
            (error, user) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding existing user (database error). Please try again.' });
                    return;
                }
                // update user's data
                user.username = request.body.username;
                // store user in persistence
                db.insert(user,
                    // manage store result
                    (error, data) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send({ message: 'Error updating existing user (database error). Please try again.' });
                            return;
                        }
                        // send ok response
                        response.status(200).send({ message: 'User updated!' });
                        return;
                    }
                );
            }
        )
    }
);

// change existing user password
// trap change password request, get data and update in persistence
app.post('/api/user/changePassword/*', auth,
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
        db.get(id,
            (error, user) =>
            {
                // manages find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ message: 'Error finding existing user (database error). Please try again.' });
                    return;
                }
                // encrypt password
                var salt = bcrypt.genSaltSync(10);
                var hash = bcrypt.hashSync(request.body.password, salt);
                // update user's data
                user.password = hash;
                // store user in persistence
                db.insert(
                    // manage store result
                    (error, data) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send({ message: 'Error changingc existing user password (database error). Please try again.' });
                            return;
                        }
                        // send ok response
                        response.status(200).send({ message: 'Password changed!' });
                        return;
                    }
                );
            }
        )
    }
);

// delete an existing user
// trap delete user request and remove from persistence
app.delete('/api/user/delete/*', auth,
    (request, response) =>
    {
        // get user's id
        var urlParts = url.parse(request.url);
        var id = urlParts.pathname.split('/').pop();
        // load user
        db.get(id,
            (error, user) =>
            {
                // manage find result
                if (error)
                {
                    // send error response
                    console.log(error);
                    response.status(500).send({ mnessage: 'Error finding existing user (database error). Please try again.' });
                    return;
                }
                // delete user from persistence
                db.destroy(user._id, user._rev,
                    (error, data) =>
                    {
                        if (error)
                        {
                            // send error response
                            console.log(error);
                            response.status(500).send({ message: 'Error deleting existing user (database error). Please try again.' });
                            return;
                        }
                        // send ok response
                        response.status(200).send({ message: 'User deleted!' });
                        return;
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