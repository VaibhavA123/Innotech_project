if(process.env.NODE_ENV != "production" ) {
    require('dotenv').config();
}
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const passportLocalMongoose = require('passport-local-mongoose');
const multer = require('multer');
const path = require('path');
const {storage} = require('./CloudConfig');
const upload = multer({storage : storage});
const cors = require('cors');
const mbxClient = require('@mapbox/mapbox-sdk');
const geocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const bodyParser = require('body-parser');
const mapToken = 'pk.eyJ1Ijoic2FydGhhazEyMSIsImEiOiJjbHhsazF0bXIwMThhMmxzM2NoeXRmZWg5In0.JT53EZpovFVZDZah9ROOpw';
const geocodingClient = geocoding({accessToken : mapToken});
const RateLimit = require('express-rate-limit');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Replace with allowed origin(s)
        methods: ['GET', 'POST'],
    },
});

app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use(express.urlencoded({extended : true}));
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, 'public')));
// app.use(bodyParser.urlencoded({ extended: true }));



const store = MongoStore.create({
    mongoUrl : process.env.MONGO_URL,
    crypto : {
        secret : process.env.secret,
    },
    touchAfter : 24 * 3600,
});

store.on("error",() => {
    console.log("ERROR in MONGO SESSION STORE",err);
});

app.use(session({
    store,
    secret : process.env.secret,
    resave : false,
    saveUninitialized : true,
    cookie : {
        expires : Date.now() + 7 * 24 * 60 * 60 * 1000,
        maxAge : 7 * 24 * 60 * 60 * 1000,
        httpOnly : true,
    },
}));


io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on("message", (msg) => {
        io.emit("message",msg);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected : ',socket.id);
        // console.log(socket);
        if (socket.user) {
            console.log('User disconnected :',socket.id,'User email:', socket.user.email);
        }
    });
});




app.use(flash());

main()
.then(() => {
    console.log("Database connected!");
})
.catch((error) => {
    console.log(error);
});

async function main() {
    await mongoose.connect(process.env.MONGO_URL);
}

const loginSchema = new mongoose.Schema({
    username : {
        type: String,
        required : true,
    },
    password : {
        type : String,
        required : true,
    }
});

const signUpSchema = new mongoose.Schema({
    email : {
        type : String,
        required : true,
    },
});

signUpSchema.plugin(passportLocalMongoose);

const Signup = mongoose.model("Signup",signUpSchema);

app.use(passport.session());
app.use(passport.initialize());
passport.use(new LocalStrategy(Signup.authenticate()));
passport.serializeUser(Signup.serializeUser());
passport.deserializeUser(Signup.deserializeUser());


app.get("/signup",(req,res) => {
    const data =  req.flash("user");
    res.render("SignupPage.ejs",{data});
});


const reviewSchema = new mongoose.Schema({
    message : {
        type : String
    },
    rating : {
        type : Number
    },
});
const ownerSchema = new mongoose.Schema({
    username : {
        type : String,
        required : true,
    },
    email : {
        type : String,
        required : true,
    },
});

const userSchema = new mongoose.Schema({
    username : {
        type : String,
        required : true,
        unique : true,
    },
    email : {
        type : String,
        required : true,
    },
    Vehicle_No : {
            type : String,
            required : true,
    },
    image : {
        url : String,
        filename: String
    },
    mobile_No1 : {
        type : Number,
        required : true,
    },
    mobile_No2 : {
        type : Number,
        required : true,
    },
    mobile_No3 : {
        type : Number,
        required : true,
    },
    current_location : {
        type : String,
        required : true,
    },
    destination : {
        type : String,
        required : true,
    },
    review : {
        type: mongoose.Schema.Types.ObjectId,
        ref : "Review"
    },
    owner : {
        type : mongoose.Schema.Types.ObjectId,
        ref : "Owner"
    },
});


const Owner = mongoose.model("Owner",ownerSchema);
const Login = mongoose.model("Login",loginSchema);
const Review = mongoose.model("Review",reviewSchema);
const User = mongoose.model("User",userSchema);


app.get("/home",(req,res) => {
    res.render("app.ejs");
});


app.post("/signup", async (req,res) => {
    let { username, email, password } = req.body;
    let data = await new Signup({username :username, email : email});
    let newData = await Signup.register(data,password);
    await newData.save();
    req.logIn(newData,(error) => {
            if(error) {
                next(error);
            }
            res.redirect("/home");
    });
});

const saveRedirectUrl = (req,res,next) => {
    if(req.session.redirectUrl) {
        res.locals.redirectUrl = req.session.redirectUrl;
    }
    next();
}


app.get("/login",(req,res) => {
    req.flash("user","User doesn't exist. Please signup first!");
    res.render("LoginPage.ejs");
});
app.post("/login",saveRedirectUrl,passport.authenticate("local",{failureFlash:true,failureRedirect:'/login'}),async (req,res) => {
    let { username, password } = req.body;
    let data = await new Login({username : username, password : password});
    await data.save();
    console.log(res.locals.redirectUrl);
    let url = res.locals.redirectUrl || "/home";
    res.redirect(url);
});


app.get("/service",(req,res) => {
    res.render("userService.ejs");
});



app.post("/service",upload.single("image"), async (req,res) => {
    let {username,email,Vehicle_No,mobile_No1,mobile_No2,mobile_No3,current_location,destination} = req.body;
    let { path,filename } = req.file;
    let data = await new User({current_location : current_location,destination : destination,username : username, email : email, Vehicle_No : Vehicle_No, mobile_No1 : mobile_No1,mobile_No2:mobile_No2,mobile_No3:mobile_No3, image : {url : path, filename : filename}});
    await data.save();
    res.redirect("/api/battery-status");
});


//testing
function getRandomNearbyCoordinates(latitude, longitude,batteryLevel, radius = 0.01) {
    // `radius` in degrees; approx. 0.01 degrees ~ 1.1 km
    const randomOffsetLat = (Math.random() - 0.5) * radius * 2;
    const randomOffsetLng = (Math.random() - 0.5) * radius * 2;

    const randomLat = latitude + randomOffsetLat;
    const randomLng = longitude + randomOffsetLng;

    return { latitude: randomLat, longitude: randomLng,batteryLevel : batteryLevel };
}


app.get("/api/battery-status",async (req,res) => {
    if(!req.isAuthenticated()) {
        req.session.redirectUrl = req.originalUrl;
        res.redirect("/login");
    }
    let data = await User.find({});
    const message = req.flash("message");
    res.render("testing.ejs",{data,message});
});

const nearbyCoordinates = [];

app.post('/api/battery-status',async (req, res) => {
    console.log('Battery status alert:', req.body);
    let latitude2 = req.body.latitude;
    let longitude2 = req.body.longitude;
    nearbyCoordinates.length = 0;
    nearbyCoordinates.push({latitude : latitude2, longitude : longitude2});
    for (let i = 0; i < 5; i++) {
        nearbyCoordinates.push(getRandomNearbyCoordinates(latitude2, longitude2));
    }
    console.log(nearbyCoordinates);
    res.json({nearbyCoordinates});
});


app.get("/api/battery-status/:_id",async (req,res) => {
    console.log(req.user);
    let { _id } = req.params;
    let review_data = await Review.find({});
    let ownerData = await Owner.find({});
    let data = await User.findById({_id : _id}).populate("review").populate("owner");
    console.log(data);
    if(data.email == req.user.email) {
    res.render("individualUser.ejs",{list : data,review_data,ownerData});
}else {
    req.flash("message","You don't have permission to access others details.");
    res.redirect("/api/battery-status");
}
});


app.get("/logout",(req,res,next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash('success', 'You have been logged out successfully.');
        res.redirect('/home');
    });
});



app.delete("/delete/review/:_id", async (req, res) => {
    try {
        let { _id } = req.params;

        // Find the user who has the review
        let user = await User.findOne({ review: _id });
        if (!user) {
            return res.status(404).send("User not found");
        }

        // Remove the reference to the review from the user's document
        user.review = undefined;
        await user.save();

        // Delete the review itself
        let deletedReview = await Review.findByIdAndDelete(_id);
        if (!deletedReview) {
            return res.status(404).send("Review not found");
        }
        console.log("Deleted review:", deletedReview);

        // Redirect to the user's battery status page
        res.redirect(`/api/battery-status/${user._id}`);
    } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).send("An error occurred while deleting the review");
    }
});

app.post("/flash_message", (req,res) => {
    let message = req.body.message;
    req.flash("danger_zone",message);
    res.status(200).json({success : "Hello"});
});


    app.get("/api/battery-status/new/:_id", (req, res) => {
        let message = req.flash("danger_zone");
        let { _id } = req.params;
        console.log(req.query.latitude);
        const latitude_destination = req.query.latitude;
        const longitude_destination = req.query.longitude;

        const danger = req.flash("danger_zone");
        if (nearbyCoordinates.length > 0) {
            let latitude = nearbyCoordinates[0].latitude;
            let longitude = nearbyCoordinates[0].longitude;
            res.render("new.ejs", {danger,message ,nearbyCoordinates, latitude, longitude,latitude_destination,longitude_destination,_id });
        } else {
            res.status(400).send("No coordinates available");
        }
    });

const emergencySchema = new mongoose.Schema({
    email : {
        type : String,
        required : true,
    },
    location : {
        longitude : String,
        latitude : String,
    },
    message : {
        type : String,
        required : true,
    },
});

const EmergencyModel = mongoose.model("EmergencyModel",emergencySchema);

    app.post("/home3", async (req,res) => {
        let { _id, latitude, longitude } = req.body;
        let data = await User.findById(_id);
        let name = data.username;
        let message = `${name} connection lost`;
        let newData = new EmergencyModel({email : data.email,message: message, location : {longitude,latitude}});
        await newData.save();
        console.log(newData);
        res.status(200).json({"data" : "data2"});
    });

    app.get("/emergency",async (req,res) => {
        let data = await EmergencyModel.find({});
        res.render("emergency.ejs",{data});
    });

    app.delete("/emergency/:_id",async(req,res) => {
        let { _id } = req.params;
        let data = await EmergencyModel.findByIdAndDelete(_id);
        console.log(data);
        res.redirect("/emergency");
    });

    const userBatteryStatusSchema = new mongoose.Schema({
        userID : {
            type : String,
            required : true,
        },
        batteryLevel : {
            type : Number,
            required : true,
        },
    });
const BatteryStatus = mongoose.model("BatteryStatus",userBatteryStatusSchema);

app.post("/home2",async (req,res) =>{
    console.log(req.body);
    const data = await new BatteryStatus({userID : req.body.userId, batteryLevel : req.body.batteryLevel});
    await data.save();
    console.log(data);
    res.status(200).json({"data" : "data2"});
});



app.get("/safety",async (req,res) => {
    let data = await BatteryStatus.find({});
    res.render("safety.ejs",{data});
});

    app.delete("/delete/:_id",async (req,res) => {
        let { _id } = req.params;
        let data = await User.findByIdAndDelete({_id : _id});
        console.log(data);
        res.redirect("/api/battery-status");
    });

    app.get("/update/:_id",(req,res) => {
        let {_id} = req.params;
        res.render("update.ejs",{_id});
    });
    app.put("/update/:_id",upload.single("image"),async (req,res) => {
        let {_id} = req.params;
        let {username,email,Vehicle_No,mobile_No,current_location,destination} = req.body;
        let { path,filename } = req.file;
        let data = await User.findByIdAndUpdate(_id,{username: username,email : email, Vehicle_No : Vehicle_No, mobile_No : mobile_No, image : {url : path,filename : filename},current_location : current_location,destination : destination});
        console.log(data);
        // res.send(req.file);
        res.redirect("/api/battery-status");
    });



    app.post("/review/:_id", async (req, res) => {
        try {
            const { _id } = req.params;
            const { message, rating } = req.body;
            const review = new Review({ message, rating });
            await review.save();
            const user = await User.findById(_id);
            if (!user) {
                return res.status(404).send("User not found");
            }
            user.review = review._id;
            await user.save();
            console.log("User with updated review:", user);
            res.redirect(`/api/battery-status/${user._id}`);
        } catch (err) {
            console.error("Error adding review:", err);
            res.status(500).send("An error occurred while adding the review");
        }
    });


    const switchSchema = new mongoose.Schema({
        username : {
            type : String,
            required : true,
        },
        emergency1 : {
            type : Number,
            required : true,
        },
        emergency2 : {
            type : Number,
            required : true,
        },
        latitude : {
            type : String,
            required: true,
        },
        longitude : {
            type : String,
            required : true,
        },
    });

const SwitchedOFF = mongoose.model("SwitchedOFF",switchSchema);

app.post("/switched_off", async (req,res) => {
    let _id = req.body._id;
    let latitude = req.body.latitude;
    let longitude = req.body.longitude;
    let data = await User.findById(_id);
    let newData = new SwitchedOFF({username : data.username,emergency1 : data.mobile_No2,emergency2 : data.mobile_No3,latitude : latitude, longitude : longitude});
    await newData.save();
    res.status(200).json({"Success":"true"});
});


app.delete("/switch_off/:_id",async(req,res) => {
    let { _id } = req.params;
    let data = await SwitchedOFF.findByIdAndDelete(_id);
    console.log(data);
    res.redirect("/switch_off");
});

app.get("/switch_off",async (req,res) => {
    let data = await SwitchedOFF.find({});
    res.render("switch_off.ejs",{data});
});


app.post("/danger_zone",(req,res) => {
    const message = req.body.message;
    req.flash("danger_zone", message);
    res.status(200).json({"message" : "hello"});
});


app.get("/app2",(req,res) => {
    res.render("app.ejs");
});


const driverSchema = new mongoose.Schema({
    driver_name : {
        type : String,
        required : true,
    },
    passenger_name : {
        type : String,
        required: true,
    },
    passenger_destination : {
        type : String,
        required : true,
    },
    passenger_aadhar : {
        type : String,
        required : true,
    },
});

const Driver = mongoose.model("Driver",driverSchema);


app.get("/driver",(req,res) => {
    const data = req.flash("saved");
    res.render("driver.ejs",{data});
});

app.post("/driver",async (req,res) => {
    let {driver_name, passenger_aadhar,passenger_destination,passenger_name} = req.body;
    console.log(req.body);
    req.flash("saved","Data saved successfully.Go back to home");
    let data = new Driver({driver_name : driver_name,passenger_aadhar : passenger_aadhar, passenger_destination : passenger_destination,passenger_name : passenger_name});
    await data.save();
    res.redirect("/driver");
});


app.use("*",(req,res) => {
    throw `${404},Page not Found!`;
});

app.use((error,req,res,next) => {
    res.render("error.ejs",{error});
});

server.listen(8080,() => {
    console.log("Server is listening to port 8080");
});