/*
 * Created by lakhe on 4/19/16.
 */
'use strict';

var express = require('express'),
    path = require('path'),
    app = express(),
    bodyParser = require('body-parser'),
    exphbs = require('express-handlebars'),
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    easySession = require('easy-session'),
    RedisStore = require('connect-redis')(session),
    expressValidator = require('express-validator'),
    passport = require('passport'),
    compression = require('compression'),
    minify = require('express-minify'),
    hpp = require('hpp'),
    userAgent = require('useragent'),
    cloudinary = require('cloudinary'),
    redisConfig = require('./lib/configs/redis.config'),
    messageConfig = require('./lib/configs/api.message.config'),
    cloudinaryController = require('./lib/controllers/cloudinary.setting.server.controller'),
    errorLogController = require('./lib/controllers/error.log.server.controller'),
    logWriter = require('./lib/helpers/application.log.writer.helper');

var configureAppSecurity = require('./lib/securityconfigs/security.config');
var dbConnector = require('./lib/helpers/database.helper');
var redisStoreOpts = {};

require('dotenv').config();

app.set('rootDir', __dirname);
logWriter.init(app);

console.log(process.env.NODE_ENV);

// Add content compression middleware
app.use(compression());
//fetch  RegExp library live from the remote server
//will async load the database from the server and compile it to a proper JavaScript supported format

userAgent(true);

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type, Authorization,x-access-token,Accept,Origin');

    // Set cache control header to eliminate cookies from cache
    res.setHeader('Cache-Control', 'no-cache="Set-Cookie, Set-Cookie2"');


    cloudinaryController.getCloudinarySetting()
        .then(function (cloudinarySetting) {
            if (cloudinarySetting) {
                if (cloudinarySetting) {
                    cloudinary.config({
                        cloud_name: cloudinarySetting.cloudinaryCloudName,
                        api_key: cloudinarySetting.cloudinaryApiKey,
                        api_secret: cloudinarySetting.cloudinaryApiSecret,
                        secure: true
                    });
                }
            }
        });
    next();
});
//set up the view engine-Handelbars
app.set('views', path.join(__dirname, '/lib/views'));
var helpers = require('./lib/helpers/handlebar.helpers');
var hbs = exphbs.create({
    defaultLayout: 'main-layout',
    layoutsDir: __dirname + '/lib/views/layouts',
    partialsDir: __dirname + '/lib/views/partials',
    extname: '.hbs',
    helpers: helpers
});
app.engine('hbs', hbs.engine);
app.engine('html', hbs.engine);
app.set('view engine', 'hbs');


// end handlebar setup
// app.use('/public', express.static(__dirname + '/public', {maxAge: 86400000}));
// Static path setup for Client App

var admin = express();
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    //  redisStoreOpts = {
    //    host: redisConfig.development.host,
    //     port: redisConfig.development.port,
    //     ttl: (20 * 60), // TTL of 20 minutes represented in seconds
    //     db: redisConfig.development.db,
    //     pass: redisConfig.development.pass
    //   };
    var adminRootPath = __dirname + "/app-src/admin/";
    app.use("/", express.static(__dirname + '/public/'));
    app.use('/scripts', express.static(__dirname + '/node_modules/'));
    app.use('/login-templates', express.static(adminRootPath + '/app/login-app/views/'));
    app.use('/app-template', express.static(adminRootPath + '/app/'));
    app.use('/login-app', express.static(adminRootPath + '/app/login-app/'));
    app.use('/shared', express.static(adminRootPath + '/app/shared/'));
    app.use('/config', express.static(adminRootPath + '/app-config/'));
    app.use('/app-src', express.static(adminRootPath));
    app.use('/admin-app', express.static(adminRootPath + '/app/admin-app/'));
    app.use('/admin-templates', express.static(adminRootPath + '/app/admin-app/views/'));
    admin.get("/*", function (req, res) {
        res.render(path.join(adminRootPath, '/index.html'), {layout: false});
    });
}
else if (process.env.NODE_ENV === "production") {
    redisStoreOpts = {
        host: redisConfig.production.host,
        port: redisConfig.production.port,
        ttl: (20 * 60), // TTL of 20 minutes represented in seconds
        pass: redisConfig.production.pass
    };
    app.use(minify());
    app.enable('view cache');
    var adminDistRootPath = path.join(__dirname, '/app-dist/admin');
    app.use("/", express.static(path.join(__dirname, '/public'), {maxAge: 86400000}));
    app.use('/scripts', express.static(path.join(__dirname, '/node_modules/'), {maxAge: 86400000}));

    var adminViews = ['/login-templates', '/admin-templates'];
    app.use(adminViews, express.static(path.join(adminDistRootPath, '/views/')));

    var adminApp = ['/login-app', '/app-template', '/shared', '/config', '/admin-app', '/dist/admin', '/app-src/app', '/app-src'];
    app.use(adminApp, express.static(adminDistRootPath));

    admin.get("/*", function (req, res) {
        res.render(path.join(adminDistRootPath, 'index.html'), {layout: false});
    });

}
app.use("/admin", admin);
app.use("/docs", express.static(__dirname + "/public/apidoc/"));
///  End of Static path setup for Client app

dbConnector.init(app);
var router = require('./lib/routes');
app.set('cloudinaryextension', 'png');
app.set('rateLimit', 100);

// create application/x-www-form-urlencoded parser
app.use(bodyParser.urlencoded({extended: false}));
// create application/json parser
app.use(bodyParser.json());
app.use(hpp());


app.use(expressValidator({
    errorFormatter: function (param, msg, value) {
        var namespace = param.split('.'),
            root = namespace.shift(),
            formParam = root;

        while (namespace.length) {
            formParam += '[' + namespace.shift() + ']';
        }
        return {
            param: formParam,
            msg: msg,
            value: value
        };
    }
}));


var sessionOpts = {
    store: new RedisStore(redisStoreOpts),
    name: 'id', // <-- a generic name for the session id
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    maxAge: 1200000,//20 minutes
    cookie: {
        // domain: 'secure.example.com' // limit the cookie exposure
        // secure: true, // set the cookie only to be served with HTTPS
        path: '/',
        httpOnly: true, // Mitigate XSS
        maxAge: null
    }
};

app.use(cookieParser(process.env.COOKIE_SECRET));
// if server behind proxy, then below should be uncommented
// app.set('trust proxy', 1) // trust first proxy
app.use(session(sessionOpts));
app.use(easySession.main(session, {
    ipCheck: true,
    uaCheck: true,
    freshTimeout: 5 * 60 * 1000,
    maxFreshTimeout: 20 * 60 * 1000
}));

app.use(passport.initialize());

configureAppSecurity.init(app);


//Map the Routes
router.init(app);

//development error handler
//will print stacktraces


if (app.get('env') === 'development') {
    app.use(function (err, req, res, next) {
        if (err) {
            errorLogController.postErrorLogs(err, req, next);
        }
        res.status(500);
        res.json({
            message: messageConfig.errorMessage.internalServerError
        });
    });
}


if (app.get('env') === 'production') {
    // production error handler
    // no stacktraces leaked to user
    app.use(function (err, req, res, next) {
        if (err) {
            errorLogController.postErrorLogs(err, req, next);
        }
        res.status(500);
        res.json({
            message: messageConfig.errorMessage.internalServerError
        });
    });
}

module.exports = app;
