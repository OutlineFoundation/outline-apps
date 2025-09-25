import { CapacitorGoPlugin } from 'outline-go-plugin';

window.testEcho = () => {
    const inputValue = document.getElementById("echoInput").value;
    CapacitorGoPlugin.echo({ value: inputValue })
}
