import React from 'react'
import Character from '../components/character'
// import Parallex from '../components/parallex'
import HeadingAbout from '../components/headingabout'
import Hobbies from '../components/hobbies'
import MyselfAbout from '../components/myselfAbout'
import Strength from '../components/strength'
import Qualification from './../components/Qualification';
import WorkAs from '../components/workas'
import Year5 from '../components/year5'
import Head from 'next/head'



const About = () => {
  return (
    <>
    <Head>
        <title>About Page</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
    
    <div className="about__page">
    <HeadingAbout />
    <Character />
    <Strength />
    {/* <SuperHero /> */}
    <Hobbies />
    <Qualification />
    <WorkAs />
    <MyselfAbout />
    <Year5 />

    {/* <Bubbles /> */}
    </div>
    </>
  )
}

export default About