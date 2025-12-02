import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-analytics.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBurHLr-175AqU84uUnhOdkiAWcDlL5xkc",
    authDomain: "bunbea-baf6e.firebaseapp.com",
    databaseURL: "https://bunbea-baf6e-default-rtdb.firebaseio.com",
    projectId: "bunbea-baf6e",
    storageBucket: "bunbea-baf6e.firebasestorage.app",
    messagingSenderId: "490606310395",
    appId: "1:490606310395:web:2994bbc24dfa4aacf3915e",
    measurementId: "G-545GZE0K53"
  };


  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);

  // export app so other modules can use the initialized Firebase app
  export { app, firebaseConfig };
