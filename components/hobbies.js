import React from "react";
import Image from 'next/image';

const Hobbies = () => {
  return (
    <>
      <h2 className="p-10 text-5xl font-bold text-center text-white bg-sky-500" id="hobbies" data-aos="fade-down">
          Hobbies
        </h2>
      <div className="hobbies__page min-h-screen mx-auto py-10 relative" data-aos="fade-down">
        <div className="hobbies__page__container w-full">
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="100">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1588666309990-d68f08e3d4a6?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=385&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"

              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Reading</h3>
                <p>
                  Reading is a great way to learn new things and to improve your
                  knowledge. I love reading books and articles about technology,
                  science, and history.📖📝
                </p>
              </div>
            </div>
          </div>
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="125">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1035&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"
              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Traveling</h3>
                <p>
                    I love traveling and exploring new places. I have been to many places in India. I love to travel with my family and friends.✈🧳
                </p>
              </div>
            </div>
          </div>
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="150">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1618519764140-d3cdc6496de1?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=387&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"
              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Watching Movies</h3>
                <p>
                    I love watching movies. I watch movies of different genres like action, comedy, drama, and horror. I also watch web series. My favorite is MCU (Marvel Cinematic Universe).🎬🍿
                </p>
              </div>
            </div>
          </div>
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="175">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1624825602528-2ac658281cd7?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=387&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"
              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Playing Cricket</h3>
                <p>
                    I love playing cricket. I play cricket with my friends and family. I also play cricket in my school team. I am a right-handed batsman and a right arm off-break bowler.🏏😍
                </p>
              </div>
            </div>
          </div>
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="200">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1560831340-b9679dc9e9f0?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=774&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"
              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Art & Craft</h3>
                <p>
                    I love doing art and craft. I love to make different types of crafts like paper crafts, clay crafts, and many more. I also love to paint.🎨🖌
                </p>
              </div>
            </div>
          </div>
          <div className="hobbies__page__card rounded-xl" data-aos="flip-up" data-aos-delay="225">
            <div className="hobbies__page__card__img">
              <Image
                src="https://images.unsplash.com/photo-1551218808-94e220e084d2?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=387&q=80"
                alt="book"
                layout="fill"
                objectFit="cover"
              />
            </div>
            <div className="hobbies__page__card__contentBox">
              <div className="hobbies__page__card__content">
                <h3>Cooking</h3>
                <p>
                    I love cooking. I cook different types of food like Indian, Chinese, Italian, and Mexican. I also like to bake cakes and cookies. It is a delicious hobby.🍽😋 
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Hobbies;