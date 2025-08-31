import React, { useState } from "react";
// import LampImg from "../assets/lamp.png";
import LampImg from "../public/assets/lamp.png";
import LightImg from "../public/assets/light.png";
import Image from "next/image";
import Link from "next/link";

const Light = () => {
  const [checked, setChecked] = useState(true);
  return (
    <>
      <div className="light__hero">
        <div className="light__lamp__container" data-aos="fade-up-right" >
          <div className="light__lamp__lamp-image">
            <Image
              layout={"responsive"}
              width={200}
              height={300}
              objectFit="contain"
              src={LampImg.src}
              alt="lamp"
            />
          </div>
          {checked && (
            <div className="light__lamp__light-image">
              <Image
                layout={"responsive"}
                objectFit="contain"
                width={200}
                height={100}
                src={LightImg.src}
                alt="light"
              />
            </div>
          )}
        </div>
        <div className="light__text__container" data-aos="fade-up-left">
          <h1>About Me</h1>
          <p>
            I am a multipurpose developer with many characteristics and skills
            that make me a good developer. I am a person who is always looking
            for new challenges and new ways to improve myself.
          </p>
          <Link href="/about">
            <div className="gotolink">
              Check About Me <i className="uil uil-arrow-right"></i>
            </div>
          </Link>
          <div className="light__text__container__label">
            <input
              type="checkbox"
              defaultChecked={checked}
              onChange={() => setChecked(!checked)}
            />
            <span className="light__text__container__label__span">
              <i className="uil uil-lightbulb-alt"></i>
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default Light;
