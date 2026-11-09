package core

import (
	"bytes"
	"encoding/hex"
	"net"
	"sync"
	"testing"
)

const (
	ipv4Header = 20 // Length of the IPv4 header in bytes.
	udpHeader  = 8  // Length of the UDP header in bytes.
	// A small NTP query packet (UDP)
	ntpHex = "45b8004c72e94000401125a2646a4100d8ef2304007b007b0038a1a7230209e8000003620000072ed8ef230ce10ff888c730e992e10ffbdbc742a583e10ffbdbcaa4151ae10ffde6c3cf01e3"
	// Two fragments of a large UDP packet.
	frag1Hex = "450003fc0001200040117bab646a41005db8d8220afa00000774af62691c476d4d1f5bd3b2d5f17b926562b91de7ab5ee5bea9fe13ed6223891668ab17e4236a4ec1bed53fb9db397f2885e0fd418dbe2f29416b3e01dfa633bd72d1486e6aa39d568a4b9906834ba06d0c39f9696cbbe96c13638c4cef0fedab2f17d9aa3eb87b6fcf7a3e614cbf7cc7141fbf174d97ef220f17d7e669752bad3965785ec1355b19a3adea31a6c148a0b77ade200962dc4f02ad302e1f927c537627dc1f56f613e1a9d69847a8adc5b965059e973312c013f3916f6c54ddedb96605590f9d81e39e3649d007a44e1b57d9086487c073b511da5b868a44ad043e013feb23903eade049bcac0c0486c6e832aabce435a054159242a27784260bdbe8318f677dc58cbcc90f5ec7a065504b8ddd66c5a53480e634deed9b075a9d23dbabd37c97a825e2c6d17b179bbe83a35b09c852db9aa8d04ee23f285d83c68ae808c1a16cb2ed7c93e1d9724c1e0f4e413dfd50814f12d648201bc3352dd87640609937db0eef31c335b182e6969b32a50cd7af1116013caeeccc9417d0918bbfb1320cdb6e215b6a0c70654bb196e99636b70c503d9d1837f1a33f4a43913390f2585b361c33912cf16ccbb0a5cfbba90be9c3a360cf11193b9738b1a1459860e0bb99418df9368174a9184aac6f9ecb1299876ce62ab5028f48cf6c93b58b4fb1ced3199d36ae9dfa4b4eb9109ca62f8b186c912939018a8257b79a93cec689223b04a62de256019d56dbe54ba989b1f22aa00ea81e50b0895b152d7841416e9f5ed209d99cb38534820c82b4298a8d93afdc134aa41a2e3cd62d43419873ac8d17487de28b15e186eefe538c2019023086923b3f9aec506589fb5504f483dd820993f6950262231cb0f914415d37a929a77c435ba3ecdab90a817d683abd4dc8028c3294770d4ee28ea71eb09fc027b9dc9afedc00fbe414eef5756d409909786c82186fce59f4305ad3ca47d72d59d2bff2224f5a2115f01bee7b71552160fefd14587f150a67ffc08e92c73f40d8ad7b6b900324ae56ea84eccdbb2872f644cea1b2e011e862f2dba10dbac8452f53a2c6c9ac9d5b33ab03fa16a1f146197d1c649ee2c65636f4973b916190107b1977fb55f4157ff57e62251d3a3e0fcc3357665c13287009a3f11fc0cfe4495a4b9bb981b0893fd06c938c5d99e3b7e68d6ad16326ea54314d5c6a428cf105bf95aea4e8374bd7ff81ecc5b6b9f050dc6482aa123c470d7c068a2f171949cb5dee61ddf3c40ec97099c527926dddb84b0ffa3f69564bb3b9632da0fc6914a80e2044793ac302e3763d762f42abc07b0ed52968f09e96ce3e5fa83822a5d35548973fdda478610fa39355db82bb4c743479743c32a93521082a131cd21439bca3735c8b01d295c67b8dfe8a0071487d8472"
	frag2Hex = "450003a00001007d40119b8a646a41005db8d822c726296a575ed8996bdad7392375d166d9894a6f0c0c08e4ae1ae9e55ae13a9f206b15cf74a43bff8f579f85344b972e7298f8c56d6a23081c19a369488a1b680af5f2e96e7d650261ac937ac709b74f45d15aa053b734cea3f5cbf400379a0e30e49bf696640a61a86076d867834cb79e7bcb798d129a28a8d81f47448ddc38b6040bd45607013d839c9198daabf8ae2f2994908e8b5d04f3194fe2def74e95e52aaf313119b9cef0bde9232fb7a95003e5fdcb9d8b759cf52d570c75f885333b600348b93fe8d0ccaa113465e37f20ce72b432ecc9c8a25809c2b2ed201a88d39b7f47023651ed6841e50b8fb298ef703888d603cd02438ac2ca563ae1ee273da555c3929a6221467f122a60bdb6484bd99d22fd4f4f3bfc41fd39e49c090acf33f46544c0705dbeb03b7249d90a398eacfbf239bcbb279e2596b06d25cfb9c6e247c34a57d55a272797f27df4fd2fc0fb23623f7c4890e05133ab2fa4f02cdd44eecabb3a49d7abae7dcb95f1429c82a685c4f69901cf22e355e31916bd20d038efc66dc37387d63a4330c516d03b6a2dd23bb9228d94c225723487792ae62888282a41e8c1c834d68ae58b4db92243671fd171157439282cfbab316439224dfb522f304a788f91c52715dc6588f0e1055455f159a28865d97292a7af670ec78afb229fcfa7cb97590d51d7fc8eb40edef005b19c8fb235f41b3bb5f6f7923b7534bf8ca8437ef93f40fabeb49b9eb9c5e8de9ad27ad8de282cea26adf3ddbd5b3ea4537535e2ddb864b125e73d330bf25d923e3df41be562b8de3bb3ce969defb159bc77cacb2337b07ac5204d8f1a39520089932ca6649a742f63c7e5e2ab25dc4bbed75faf68796dd5d521aee6452fbecc6af63623a1c55ad02de7c727c265ef8a4cdd109d41a7be9a5597dc69c3803e77340f2dff5608817b9c6d7c340c351e451401599a6ede93a0a897bd9bfe2dba1bfc7b61683ee9ff266a8a49fbec63ea60e4a58473c3705404cd3b3ff96415fcc92672a045555f48418a7125f0f4bda7b2df2d367af6d0e9d27a1f3895148c002b1503c6b83efa2a1e93def67fa07937d355b04a193465094e16128f33017e892d0bd154b9b87985eb6571d074d6011863b5af1395972d9415b21bd83d971cf5f3f67cc73dc0ab057aad3c83af4f6b10d5a6d8102ee3fe9f25929a14306871bf579e56dfd69cf45dd1472bbfcb1f0ab7fbb3972e27e2aba98273383b50700872d73f5c2ecf6ce3ea384ec08c4818fcfe0ed86513d617025f52"
)

var ntp, ntpPayload, frag1, frag2, fragPayload []byte

func decode(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

// This is a trivial UDP handler that sends each received packet to a channel for inspection.
type fakeUDPHandler struct {
	UDPConnHandler
	packets chan []byte
}

func (h *fakeUDPHandler) Connect(conn UDPConn, target *net.UDPAddr) error {
	return nil
}

func (h *fakeUDPHandler) ReceiveTo(conn UDPConn, data []byte, addr *net.UDPAddr) error {
	h.packets <- data
	return nil
}

func setupUDP(t *testing.T) (LWIPStack, *fakeUDPHandler) {
	// Reinitialize source data before each test to avoid interference.
	ntp = decode(ntpHex)
	ntpPayload = ntp[ipv4Header+udpHeader:]
	frag1 = decode(frag1Hex)
	frag2 = decode(frag2Hex)
	fragPayload = append([]byte(nil), frag1[ipv4Header+udpHeader:]...)
	fragPayload = append(fragPayload, frag2[ipv4Header:]...)

	// Reset the set of known UDP connections to empty before each test.  Otherwise, the
	// tests will interfere with each other.
	udpConns = sync.Map{}

	s := NewLWIPStack()
	// This channel is buffered because the first Write->ReceiveTo can either be synchronous or
	// asynchronous, depending on the results of a race during "connection".
	h := &fakeUDPHandler{packets: make(chan []byte, 1)}
	RegisterUDPConnHandler(h)
	return s, h
}

func write(s LWIPStack, b []byte, t *testing.T) {
	if _, err := s.Write(b); err != nil {
		t.Fatal(err)
	}
}

func checkedCopy(dst, src []byte, t *testing.T) {
	if copy(dst, src) != len(src) {
		t.Fatal("Copy failed due to test misconfiguration")
	}
}

func assertEqual(actual, expected []byte, t *testing.T) {
	if !bytes.Equal(actual, expected) {
		t.Error("Payloads are not equal")
	}
}

// Basic test for sending a single UDP packet.
func TestUDP(t *testing.T) {
	s, h := setupUDP(t)
	write(s, ntp, t)
	assertEqual(<-h.packets, ntpPayload, t)
}

// Send a fragmented UDP packet.
func TestUDPFragmentation(t *testing.T) {
	s, h := setupUDP(t)
	write(s, frag1, t)
	write(s, frag2, t)
	assertEqual(<-h.packets, fragPayload, t)
}

// Write UDP fragments out of order.
func TestUDPFragmentReordering(t *testing.T) {
	s, h := setupUDP(t)
	write(s, frag2, t)
	write(s, frag1, t)
	assertEqual(<-h.packets, fragPayload, t)
}

// Send a fragmented UDP packet where fragments reuse the same buffer.
func TestUDPFragmentationMemory(t *testing.T) {
	s, h := setupUDP(t)
	buf := make([]byte, len(frag1))

	checkedCopy(buf, frag1, t)
	write(s, buf[:len(frag1)], t)

	checkedCopy(buf, frag2, t)
	write(s, buf[:len(frag2)], t)

	assertEqual(<-h.packets, fragPayload, t)
}

// Regression test for a segmentation fault.
func TestUDPFragmentationMemoryAndReordering(t *testing.T) {
	s, h := setupUDP(t)
	buf := make([]byte, len(frag1))

	checkedCopy(buf, frag2, t)
	write(s, buf[:len(frag2)], t)

	checkedCopy(buf, frag1, t)
	write(s, buf[:len(frag1)], t)

	assertEqual(<-h.packets, fragPayload, t)
}
