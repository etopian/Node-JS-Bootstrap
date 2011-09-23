var express = require('express');

var ArticleProvider = require('./articleProvider.js').ArticleProvider;
var connect = require('express/node_modules/connect');
var RedisStore = require('connect-redis')(express);
var sessionStore = new RedisStore();
var redis = require("redis");
var client = redis.createClient();
var bcrypt = require('bcrypt'); 

var Session = connect.middleware.session.Session,
    parseCookie = connect.utils.parseCookie

client.on("error", function (err) {
    console.log("Error " + err);
});
var app = module.exports = express.createServer();

// = Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({
    store: sessionStore,
    secret: 'shhhhhh',
    key: 'my.sid',
    cookie: {maxAge: 31557600000 }
  }));
  app.use(express.methodOverride());
  app.use(require('stylus').middleware({ src: __dirname + '/public' }));
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

var userProvider = new ArticleProvider('users');
var countProvider = new ArticleProvider('count');

countProvider.getUniqueId('saves', function(error, count) { 
  if (error) {
    console.log('Could not determine count');
  }
  console.log('The count is: ' + count);
});

client.incr("connections", function (err, reply) {
  console.log("This has been run " + reply + " times!");
});

// Routes
function loadUser(req, res, next) {
  if (req.session.user && req.cookies.rememberme) {
    req.user = req.session.user;
  }
  else {
    req.user = {};
  }
  next();
}

app.get('/', loadUser, function(req, res){
  res.render('index', {
    title: 'Fun', loggedInUser:req.user 
  });
});

app.get('/about', loadUser, function(req, res){
  res.render('about', {
    title: 'About', loggedInUser:req.user 
  });
});

app.get('/posts', loadUser, function(req, res){
  userProvider.findAll(function(error, posts) { 
    res.render('posts', { posts: posts, title: 'Posts', loggedInUser:req.user  });
  });
});

app.get('/users', loadUser, function(req, res){
  userProvider.findAll(function(error, users) { 
    res.render('users', { users: users, title: 'Users', loggedInUser:req.user });
  });
});

app.get('/user/create', loadUser, function(req, res, next){
  res.render('users/create', { title: 'New User', loggedInUser:req.user });
});

app.post('/user/create', loadUser, function(req, res, next){
  countProvider.getUniqueId('users', function(error, id) {
    userProvider.save({
      _id: id,
      name: req.param('name'),
      email: req.param('email')
    }, function( error, docs) {
      res.redirect('/users')
    });
  });
});

app.get('/user/:id/edit', loadUser, function(req, res, next){
  userProvider.findById(req.params.id, function(error, user) {
    res.render('users/edit', { user: user, title: 'User ' + req.params.id, loggedInUser:req.user });
  });
});

app.get('/user/:id/remove', loadUser, function(req, res, next){
  if (req.params.id === 'null') {
    res.redirect('/users');
  }
  if (req.user.is_root || req.user.is_admin || req.user._id == req.params.id) { 
    userProvider.remove(req.params.id, function(error, id){
      console.log('Deleted user ' + id);
    });
    if (req.user._id == req.params.id) { 
      res.redirect('/logout');
    }
    else {
      res.redirect('/users');
    }
  }
  else {
    console.log(typeof req.user._id + ' can\'t delete this user! ' + typeof req.params.id);
    res.redirect('/users')
  }
});

app.post('/user/:id/submit', loadUser, function(req, res){
  errors = [];
  data = {};
  if (req.param('password')) {
    if (req.param('password').length < 5) {
      errors.push('Password too short.');  
    }
    else if (req.param('password') !== req.param('password_confirm')) {
      errors.push('Passwords did not match.');  
    }
    else {
      var salt = bcrypt.gen_salt_sync(10);  
      var hash = bcrypt.encrypt_sync(req.param('password'), salt);
      data.password = hash;
    }
  }
  if (!req.param('username')) {
    errors.push('Username required.');  
  }
  if (!req.param('name')) {
    errors.push('Name required.');  
  }
  if (!/.*@.*\..*/.test(req.param('email'))){
    errors.push('Valid email required.');  
  }
  if (errors.length == 0) {
    data.name = req.param('name');
    data.username = req.param('username');
    data.email = req.param('email');
    if (req.user.is_root) {
      data.is_root = req.param('is_root');
      data.is_admin = req.param('is_admin');
    }
    userProvider.findOne({$or: [{username: req.param('username')},{email: req.param('email')}], _id: {$ne: req.params.id}}, function (error, user) {
      // I don't know why the filter isn't working in the query?!!?
      if (user._id != req.params.id) {
        if (user.username == req.param('username')) {
          errors.push('Username already taken.' + req.params.id);  
        }
        if (user.email == req.param('email')) {
          errors.push('Email Address already taken.');  
        }
        console.log(errors);
        res.redirect('/user/' + req.params.id + '/edit/?' + errors);
      }
      else {
        userProvider.update({
          _id: req.params.id,
          data : data
        }, function( error, docs) {
          res.redirect('/user/' + req.params.id);
        });
      }
    });
  }
  else  {
    console.log(errors);
    res.redirect('/user/' + req.params.id + '/edit/?' + errors);
  }
});

app.get('/user/:id', loadUser, function(req, res, next){
  userProvider.findById(req.params.id, function(error, user) {
    res.render('users/user', { user: user, title: 'User ' + req.params.id, loggedInUser:req.user });
  });
});

app.post('/login', loadUser, function(req, res){
  if (req.param('username') && req.param('password')) {
    userProvider.findOne({username: req.param('username')}, function (error, user) {
      if (error || !user) {
        console.log('Couldn\'t find user! ' + req.param('username'));
      }
      else {
        if (bcrypt.compare_sync(req.param('password'), user.password)) {
          if (req.session) {
            console.log('Someone logged in! ' + req.param('username') + ' ' + user._id);
            req.session.user = user;
            if (req.param('remember') == 'on') {
              res.cookie('rememberme', 'yes', { maxAge: 31557600000});
            }
            else {
              res.cookie('rememberme', 'yes');
            }
          }
        }
        else {
          console.log('Wrong password for ' + user.username + '!');
        }
      }
      res.redirect('back');
    });
  }
});

app.get('/logout', function(req, res){
    if (req.session.user) {
      console.log('Logging Out: ' + req.session.user.username);
      delete req.session.user;
      res.clearCookie('rememberme', {path:'/'});
    }
    res.redirect('/');
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
