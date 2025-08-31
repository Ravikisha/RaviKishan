import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// import {getFirestore} from "firebase/firestore";
import {getFirestore} from "firebase/firestore";


const firebaseConfig = {
    apiKey: "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0",
    authDomain: "myportifilio-3ab5f.firebaseapp.com",
    projectId: "myportifilio-3ab5f",
    storageBucket: "myportifilio-3ab5f.appspot.com",
    messagingSenderId: "885178289992",
    appId: "1:885178289992:web:107ee346dbbea51a252d7d",
    measurementId: "G-34JFCNNQG2"
  };

// 
const app = initializeApp(firebaseConfig);
const database = getFirestore(app);
export default database;