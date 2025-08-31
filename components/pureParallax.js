import React, { useState, useEffect } from "react";
import Img1 from "../public/assets/1.png";
import Img2 from "../public/assets/2.png";
import Img3 from "../public/assets/3.png";
import Img4 from "../public/assets/4.png";
import Img5 from "../public/assets/5.png";
import Img6 from "../public/assets/6.png";
import Img7 from "../public/assets/7.png";
import Img8 from "../public/assets/8.png";
import Img9 from "../public/assets/9.png";

const PureParallax = () => {
  const [clientXval, setClientXval] = useState(0);
  const [clientYval, setClientYval] = useState(0);

  const HandleMouseMove = (e) => {
    setClientXval(e.clientX);
    setClientYval(e.clientY);
  };

  const imgMoved = (val) => {
    var x = (clientXval * val) / 250;
    var y = (clientYval * val) / 250;
    return "translateX(" + x + "px) translateY(" + y + "px)";
  };

  useEffect(() => {
    window.addEventListener("mousemove", HandleMouseMove);
    return () => window.removeEventListener("mousemove", HandleMouseMove);
  }, []);

  // console.log(clientXval,clientYval);
  return (
    <>
      <div className="parallax" data-aos="fade-up" data-aos-delay="200">
        <div className="parallax__container">
          <div className="flex flex-col items-center justify-center">
            <h2
              className="object"
              data-value="3"
              style={{ transform: imgMoved(3) }}
            >
              SKILLS
              <br />
              <span></span>
            </h2>
            <div className="flex justify-center gap-4 mt-10 z-10">
              <button
                className="custom-btn btn-11"
                style={{ fontFamily: "Playfair Display" }}
                onClick={() => window.open("#PL", "_self")}
              >
                Skills<div className="dot"></div>
              </button>

              <button
                className="custom-btn btn-11"
                style={{ fontFamily: "Playfair Display" }}
                onClick={() => window.open("#certificate", "_self")}
              >
                Certificates<div className="dot"></div>
              </button>
            </div>
          </div>
          <img
            src={Img1.src}
            className="object"
            data-value="-2"
            style={{ transform: imgMoved(-2) }}
            alt=""
          />
          <img
            src={Img2.src}
            className="object"
            data-value="6"
            style={{ transform: imgMoved(6) }}
            alt=""
          />
          <img
            src={Img3.src}
            className="object"
            data-value="4"
            style={{ transform: imgMoved(4) }}
            alt=""
          />
          <img
            src={Img4.src}
            className="object"
            data-value="-6"
            style={{ transform: imgMoved(-6) }}
            alt=""
          />
          <img
            src={Img5.src}
            className="object"
            data-value="8"
            style={{ transform: imgMoved(8) }}
            alt=""
          />
          <img
            src={Img6.src}
            className="object"
            data-value="-4"
            style={{ transform: imgMoved(-4) }}
            alt=""
          />
          <img
            src={Img7.src}
            className="object"
            data-value="5"
            style={{ transform: imgMoved(5) }}
            alt=""
          />
          <img
            src={Img8.src}
            className="object"
            data-value="-9"
            style={{ transform: imgMoved(-9) }}
            alt=""
          />
          <img
            src={Img9.src}
            className="object"
            data-value="-5"
            style={{ transform: imgMoved(-5) }}
            alt=""
          />
        </div>
      </div>
    </>
  );
};

export default PureParallax;
