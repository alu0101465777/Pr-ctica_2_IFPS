// Ejercicio 1 - Práctica 2 (BC)
// Código de la sección 3 del enunciado con pequeñas correcciones:
//  - Conexión a IPFS en 127.0.0.1 (Chrome bloquea las peticiones a 0.0.0.0).
//  - eth_requestAccounts en lugar de window.ethereum.enable() (obsoleto).
//  - Se espera a que la transacción se mine y se muestran el CID y el hash de la tx.
import React, { useEffect, useState } from "react";
import "./App.css";
import { create } from "kubo-rpc-client";
import { ethers } from "ethers";
import { Buffer } from "buffer";

import logo from "./ethereumLogo.png";
import { addresses, abis } from "./contracts";

const IPFS_API = "http://127.0.0.1:5001/api/v0";
const IPFS_GATEWAY = "http://127.0.0.1:8080/ipfs/";
const ETHERSCAN = "https://sepolia.etherscan.io/tx/";

const defaultProvider = new ethers.providers.Web3Provider(window.ethereum);
// version 6
// const defaultProvider = new ethers.BrowserProvider(window.ethereum);

const ipfsContract = new ethers.Contract(addresses.ipfs, abis.ipfs, defaultProvider);

async function readCurrentUserFile() {
  const result = await ipfsContract.userFiles(
    await defaultProvider.getSigner().getAddress()
  );
  console.log({ result });
  return result;
}

function App() {
  const [ipfsHash, setIpfsHash] = useState("");
  const [account, setAccount] = useState("");
  const [file, setFile] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [status, setStatus] = useState("");

  // Conectar con MetaMask y leer el último CID guardado por la cuenta
  useEffect(() => {
    async function init() {
      try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        setAccount(accounts[0]);
        const saved = await readCurrentUserFile();
        if (saved) setIpfsHash(saved);
      } catch (err) {
        console.log(err);
        setStatus("Error al conectar: " + err.message);
      }
    }
    init();
  }, []);

  async function setFileIPFS(hash) {
    const ipfsWithSigner = ipfsContract.connect(defaultProvider.getSigner());
    console.log("TX contract");
    const tx = await ipfsWithSigner.setFileIPFS(hash);
    console.log({ tx });
    setTxHash(tx.hash);
    setStatus("Transacción enviada, esperando confirmación...");
    await tx.wait();
    setStatus("Transacción confirmada en Sepolia.");
    setIpfsHash(hash);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return setStatus("Selecciona un fichero primero.");
    try {
      setStatus("Subiendo a IPFS...");
      // conectar a la instancia local de IPFS
      const client = create({ url: IPFS_API });
      // añadir el archivo a IPFS
      const result = await client.add(file);
      // añadir al MFS del nodo para verlo en la pestaña "Files" del dashboard
      try {
        await client.files.cp(`/ipfs/${result.cid}`, `/${result.cid}`);
      } catch (cpErr) {
        console.log("El fichero ya estaba en MFS:", cpErr.message);
      }
      console.log(result.cid.toString());
      // guardar el CID en Ethereum a través del smart contract
      await setFileIPFS(result.cid.toString());
    } catch (error) {
      console.log(error);
      setStatus("Error: " + error.message);
    }
  };

  const retrieveFile = (e) => {
    const data = e.target.files[0];
    const reader = new window.FileReader();
    reader.readAsArrayBuffer(data);
    console.log(data);
    reader.onloadend = () => {
      console.log("Buffer data: ", Buffer.from(reader.result));
      setFile(Buffer.from(reader.result));
    };
    e.preventDefault();
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>Upload a file to store it on IPFS and save the hash on ethereum.</p>
        <form className="form" onSubmit={handleSubmit}>
          <input type="file" name="data" onChange={retrieveFile} />
          <button type="submit" className="btn">Upload</button>
        </form>
        <div className="info">
          <p>Cuenta: {account || "no conectada"}</p>
          {status && <p>{status}</p>}
          {ipfsHash && (
            <p>
              CID guardado en el contrato:{" "}
              <a href={IPFS_GATEWAY + ipfsHash} target="_blank" rel="noreferrer">{ipfsHash}</a>
            </p>
          )}
          {txHash && (
            <p>
              Transacción:{" "}
              <a href={ETHERSCAN + txHash} target="_blank" rel="noreferrer">{txHash}</a>
            </p>
          )}
        </div>
      </header>
    </div>
  );
}

export default App;
