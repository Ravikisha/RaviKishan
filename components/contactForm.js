import React, { useState } from "react";
import Database from "./utils/database";
import { collection, addDoc } from "firebase/firestore";

const ContactForm = () => {
  const [fName, setFName] = useState("");
  const [lName, setLName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  function submitHandler(e) {
    e.preventDefault();
    addDoc(collection(Database, "myportifilio"), {
      first_name: fName,
      last_name: lName,
      email: email,
      phone: phone,
      message: message,
      date: new Date().toLocaleString(),
    })
      .then(() => {
        alert("We got your message ! I will contact you soon.");
        setFName("");
        setLName("");
        setEmail("");
        setPhone("");
        setMessage("");
      })
      .catch((err) => {
        alert(err.message);
        setFName("");
        setLName("");
        setEmail("");
        setPhone("");
        setMessage("");
      });
  }

  return (
    <>
      <div className="contact overflow-x-hidden">
        <section className="contact__section">
          {/* <span className="mybefore"></span>
        <span className="myafter"></span> */}
          <form className="contact__container" onSubmit={submitHandler}  data-aos="flip-up">
            <h2>Contact To Me</h2>
            <div className="contact__row100" >
              <div className="contact__col">
                <div className="contact__inputBox">
                  <input
                    type="text"
                    name=""
                    required="required"
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                  />
                  <span className="text">First Name</span>
                  <span className="line"></span>
                </div>
              </div>
              <div className="contact__col">
                <div className="contact__inputBox">
                  <input
                    type="text"
                    name=""
                    required="required"
                    value={lName}
                    onChange={(e) => setLName(e.target.value)}
                  />
                  <span className="text">Last Name</span>
                  <span className="line"></span>
                </div>
              </div>
            </div>
            <div className="contact__row100">
              <div className="contact__col">
                <div className="contact__inputBox">
                  <input
                    type="text"
                    name=""
                    required="required"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <span className="text">Email</span>
                  <span className="line"></span>
                </div>
              </div>
              <div className="contact__col">
                <div className="contact__inputBox">
                  <input
                    type="text"
                    name=""
                    required="required"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <span className="text">Phone</span>
                  <span className="line"></span>
                </div>
              </div>
            </div>
            <div className="contact__row100">
              <div className="contact__col">
                <div className="contact__inputBox contact__textarea">
                  <textarea
                    required="required"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  ></textarea>
                  <span className="text">Type Your Message Here...</span>
                  <span className="line"></span>
                </div>
              </div>
            </div>
            <div className="contact__row100">
              <div className="contact__col">
                <input type="submit" value="Send" />
              </div>
            </div>
          </form>
        </section>
      </div>
    </>
  );
};

export default ContactForm;
