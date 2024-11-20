if(process.env.NODE_ENV != "production" ) {
    require('dotenv').config();
}
const express = require('express');
const app = express();
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
const cors = require('cors');


app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use(express.urlencoded({extended : true}));
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(methodOverride("_method"));
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

const Login = mongoose.model("Login",loginSchema);

const reviewSchema = new mongoose.Schema({
    message : {
        type : String
    },
    rating : {
        type : Number
    },
});

const userSchema = new mongoose.Schema({
    username : {
        type : String,
        required : true,
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
    mobile_No : {
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
    }
});

const Review = mongoose.model("Review",reviewSchema);


const User = mongoose.model("User",userSchema);


const rateLimit = RateLimit({
    windowMS : 1 * 60 * 1000,
    max : 15,
    message : "To many requests,Please try after 1 minutes"
});

app.use(helmet());
app.use(rateLimit);


app.get("/home",(req,res) => {
    res.render("Home.ejs");
});

app.post("/signup", async (req,res) => {
    let { username, email, password } = req.body;
    let data = await new Signup({username :username, email : email});
    let newData = await Signup.register(data,password);
    // await newData.save();
    res.redirect("/home");
});

app.get("/login",(req,res) => {
    req.flash("user","User doesn't exist. Please signup first!");
    res.render("LoginPage.ejs");
});
app.post("/login",passport.authenticate("local",{failureFlash:true,failureRedirect:'/signup'}),async (req,res) => {
    let { username, password } = req.body;
    if(!req.isAuthenticated()) {
        return res.redirect("/login");
    }
    let data = await new Login({username : username, password : password});
    await data.save();
    res.redirect("/home");
});


function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    req.flash("error", "Please log in first.");
    res.redirect("/login");
}

app.get("/service", isAuthenticated ,(req,res) => {
    res.render("userService.ejs");
});



app.post("/service",upload.single("image"), async (req,res) => {
    let {username,email,Vehicle_No,mobile_No,current_location,destination} = req.body;
        let { path,filename } = req.file;
        let data = await new User({current_location : current_location,destination : destination,username : username, email : email, Vehicle_No : Vehicle_No, mobile_No : mobile_No, image : {url : path, filename : filename}});
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

app.get("/api/battery-status", async (req,res) => {
    let data = await User.find({});
    res.render("testing.ejs",{data});
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
    let { _id } = req.params;
    let review_data = await Review.find({});
    let data = await User.findById({_id : _id}).populate("review");
    console.log(data);
    res.render("individualUser.ejs",{list : data,review_data});
});


app.get("/logout",(req,res,next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash('success', 'You have been logged out successfully.');
        res.redirect('/login');
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



    app.get("/new", (req, res) => {

        console.log(req.query.latitude);
        const latitude_destination = req.query.latitude;
        const longitude_destination = req.query.longitude;

        if (nearbyCoordinates.length > 0) {
            let latitude = nearbyCoordinates[0].latitude;
            let longitude = nearbyCoordinates[0].longitude;
            res.render("new.ejs", { nearbyCoordinates, latitude, longitude,latitude_destination,longitude_destination });
        } else {
            res.status(400).send("No coordinates available");
        }
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



app.use("*",(req,res) => {
    throw `${404},Page not Found!`;
});

app.use((error,req,res,next) => {
    res.render("error.ejs",{error});
});

app.listen(8080,() => {
    console.log("Server is listening to port 8080");
});