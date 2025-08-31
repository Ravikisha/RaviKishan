import React, { useState } from "react";

const Character = () => {
  const [videoIndex, setVideoIndex] = useState(0);

  const nextVideoIndex = () => {
    setVideoIndex((prev) => (prev + 1) % 4);
  };
  const prevVideoIndex = () => {
    setVideoIndex((prev) => (prev - 1 + 4) % 4);
  };
  return (
    <>
      <div className="container__character" id="characteristics" data-aos="fade-down">
        <div className="bannerVideo" id="slideShow">
          <video
            className={
              videoIndex == 0
                ? "character__video active__video"
                : "character__video"
            }
            src="https://videos.pexels.com/video-files/4828773/4828773-hd_1920_1080_25fps.mp4"
            autoPlay
            muted
            loop
          ></video>
          <video
            className={
              videoIndex == 1
                ? "character__video active__video"
                : "character__video"
            }
            src="https://videos.pexels.com/video-files/857267/857267-hd_1920_1080_24fps.mp4"
            autoPlay
            muted
            loop
          ></video>
          <video
            className={
              videoIndex == 2
                ? "character__video active__video"
                : "character__video"
            }
            src="https://videos.pexels.com/video-files/3764706/3764706-hd_1920_1080_30fps.mp4"
            autoPlay
            muted
            loop
          ></video>
          <video
            className={
              videoIndex == 3
                ? "character__video active__video"
                : "character__video"
            }
            src="https://videos.pexels.com/video-files/855222/855222-hd_1920_1080_25fps.mp4"
            autoPlay
            muted
            loop
          ></video>
        </div>
        <div className="character__content">
          <div className="character__bannerText">
            <div className={videoIndex == 0 ? "active__slide" : ""}>
              <h2>Endless Patience</h2>
              <p>
                Patience is the most important trait to become a great
                programmer. There might be a situation where i get stuck while
                programming, the only way through it is to stick with the work.
                It is also true that i can’t forcibly learn patience but i
                can develop it if i have an interest in programming.
              </p>
            </div>
            <div className={videoIndex == 1 ? "active__slide" : ""}>
              <h2>Desire To Learn</h2>
              <p>
                A great programmer should be curious and should have the desire
                to learn everything possible. In a field like software
                development that&apos;s changing and advancing every moment, i
                should grasp knowledge and information from everywhere. And it
                is equally important to adapt to the change. Most programmers
                like to solve problems and take up challenges that others would
                not. This is what keeps them up all night to find the right
                solution. Not all the programmers do it for money but for the
                passion they have.
              </p>
            </div>
            <div className={videoIndex == 2 ? "active__slide" : ""}>
              <h2>Logical Thinking</h2>
              <p>
                Being a logical thinker is one of the most important virtues we
                see in a good programmer. If i have logical thinking, i will
                easily be able to find answers to the problems. All it requires
                is for me to think about the solution with a calm mind and use
                all my knowledge and logic. The ability to handle a problem in
                a logical, analytical way is what makes a great programmer
                different from others.
              </p>
            </div>
            <div className={videoIndex == 3 ? "active__slide" : ""}>
              <h2>Self-Discipline</h2>
              <p>
                As a programmer, i will be spending a lot of time working
                alone. Even if there’s no one in the room, i need to keep
                myself in the working zone for quite a lot of time. This
                brings us to self-discipline. You need to stay focused and
                dedicated to the work i’m doing. I need to keep myself
                motivated to work for long days.
              </p>
            </div>
            <ul className="controls">
              <li onClick={nextVideoIndex}>
                <i className="uil uil-arrow-left"></i>
              </li>
              <li onClick={prevVideoIndex}>
                <i className="uil uil-arrow-right"></i>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
};

export default Character;
