"use client";

import { motion } from "framer-motion";
import { Cpu, Route, Bot, Code2 } from "lucide-react";

const features = [
  {
    icon: Cpu,
    title: "Serverless Inference",
    description: "Run AI models without managing GPU infrastructure. Scale automatically with demand.",
  },
  {
    icon: Route,
    title: "Intelligent Routing",
    description: "Automatically route requests to the best available model based on cost, latency, and performance.",
  },
  {
    icon: Bot,
    title: "Autonomous Agents",
    description: "Build AI agents that can execute complex workflows and interact with external tools seamlessly.",
  },
  {
    icon: Code2,
    title: "Developer First",
    description: "Simple APIs and infrastructure designed for developers. Get started in minutes, not days.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function Features() {
  return (
    <section id="product" className="py-24 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-7xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white">
            Everything you need to build AI
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            Powerful features designed for modern AI development.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={item}
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
              className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 hover:border-zinc-700 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
                <feature.icon className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-zinc-400 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
